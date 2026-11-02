// Applying one webhook event to the mirror (MIRROR-R11, MIRROR-R12, MIRROR-R14). Runs inside
// the receiver's transaction and writes only through ../mirror/apply.ts.
//
// | type             | create, update                                    | remove            |
// |------------------|---------------------------------------------------|-------------------|
// | Project          | normalise, merge with the stored row, scope, upsert | flag removed    |
// | Initiative       | the same                                          | flag removed      |
// | ProjectUpdate    | set the project's latest update if newer          | clear it if latest |
// | InitiativeUpdate | set the initiative's latest update if newer       | clear it if latest |
//
// Scope (MIRROR-R12), before any write:
// - A project or initiative the scope filter rejects is dropped. If the mirror holds it
//   (it moved to private teams only, or its lead team became private), it is flagged
//   removed, unless the event is older than the stored row.
// - The known public teams are the mirror's (read.ts publicTeamIds). Linear sends no team
//   webhooks, so a project whose only teams are new to the mirror is dropped until the next
//   reconcile refreshes teams and brings it in.
// - An update event writes only to a parent the mirror holds and has not removed, so an
//   update in a private project never lands.
// - A trashed entity, or an archived or trashed update, counts as removed.
import {
  applyLatestUpdate,
  applyRecords,
  clearLatestUpdate,
  type Db,
  markRemoved,
  type UpdatedType,
  type WriteContext,
} from "../mirror/apply.ts";
import { getMirrored, publicTeamIds } from "../mirror/read.ts";
import { scopeInitiative, scopeProject } from "../mirror/scope.ts";
import {
  initiativeFromPayload,
  isTrashed,
  PayloadError,
  projectFromPayload,
  updateFromPayload,
  type WebhookEvent,
} from "./payload.ts";

export type EventCounts = {
  inserted: number;
  updated: number;
  unchanged: number;
  /** Flagged removed. */
  removed: number;
  /** Out of scope (MIRROR-R12), never written. */
  dropped: number;
};

export type EventOutcome = "applied" | "dropped" | "ignored";

export type EventResult = {
  outcome: EventOutcome;
  /** The entity the event is about, when the type is followed. */
  entityId: string | null;
  counts: EventCounts;
  /** Rows inserted, updated or flagged removed. */
  changed: number;
};

const actions: ReadonlySet<string> = new Set(["create", "update", "remove"]);

const zero = (): EventCounts => ({ inserted: 0, updated: 0, unchanged: 0, removed: 0, dropped: 0 });

function result(outcome: EventOutcome, entityId: string | null, counts: EventCounts): EventResult {
  return {
    outcome,
    entityId,
    counts,
    changed: counts.inserted + counts.updated + counts.removed,
  };
}

/** Whether an event is newer than, or as new as, what the mirror holds. */
function notOlder(updatedAt: string, stored: { updatedAt: string } | null): boolean {
  return stored === null || Date.parse(updatedAt) >= Date.parse(stored.updatedAt);
}

/** The id of the event's entity; a remove needs nothing else. */
function entityId(event: WebhookEvent): string {
  const id = event.data.id;
  if (typeof id !== "string" || id === "") throw new PayloadError("data.id is missing");
  return id;
}

async function removeEntity(
  sql: Db,
  type: UpdatedType,
  id: string,
  context: WriteContext,
): Promise<EventResult> {
  const counts = zero();
  counts.removed = await markRemoved(sql, type, [id], context);
  if (counts.removed === 0) counts.unchanged = 1;
  return result("applied", id, counts);
}

async function applyProject(sql: Db, event: WebhookEvent, context: WriteContext) {
  const id = entityId(event);
  if (event.action === "remove" || isTrashed(event.data)) {
    return removeEntity(sql, "projects", id, context);
  }
  const stored = await getMirrored(sql, "projects", id);
  const record = projectFromPayload(event.data, stored);
  const kept = scopeProject(record, await publicTeamIds(sql));
  return kept
    ? applyKept(sql, "projects", kept, context)
    : dropEntity(sql, "projects", record, stored, context);
}

async function applyInitiative(sql: Db, event: WebhookEvent, context: WriteContext) {
  const id = entityId(event);
  if (event.action === "remove" || isTrashed(event.data)) {
    return removeEntity(sql, "initiatives", id, context);
  }
  const stored = await getMirrored(sql, "initiatives", id);
  const candidate = initiativeFromPayload(event.data, stored);
  const kept = scopeInitiative(candidate, await publicTeamIds(sql));
  return kept
    ? applyKept(sql, "initiatives", kept, context)
    : dropEntity(sql, "initiatives", candidate, stored, context);
}

async function applyKept<T extends UpdatedType>(
  sql: Db,
  type: T,
  record: Parameters<typeof applyRecords<T>>[2][number],
  context: WriteContext,
): Promise<EventResult> {
  const applied = await applyRecords(sql, type, [record], context);
  return result("applied", record.id, { ...zero(), ...applied });
}

async function dropEntity(
  sql: Db,
  type: UpdatedType,
  record: { id: string; updatedAt: string },
  stored: { updatedAt: string; removedAt: string | null } | null,
  context: WriteContext,
): Promise<EventResult> {
  const counts = { ...zero(), dropped: 1 };
  if (stored && stored.removedAt === null && notOlder(record.updatedAt, stored)) {
    counts.removed = await markRemoved(sql, type, [record.id], context);
  }
  return result("dropped", record.id, counts);
}

async function applyUpdate(
  sql: Db,
  event: WebhookEvent,
  type: UpdatedType,
  context: WriteContext,
): Promise<EventResult> {
  const { parentId, update, gone } = updateFromPayload(
    event.data,
    type === "projects" ? "project" : "initiative",
  );
  const parent = await getMirrored(sql, type, parentId);
  if (parent === null || parent.removedAt !== null) {
    return result("dropped", update.id, { ...zero(), dropped: 1 });
  }
  const counts = zero();
  const changed =
    event.action === "remove" || gone
      ? await clearLatestUpdate(sql, type, parentId, update.id, context)
      : await applyLatestUpdate(sql, type, parentId, update, context);
  if (changed) counts.updated = 1;
  else counts.unchanged = 1;
  return result("applied", update.id, counts);
}

/** Applies one verified event. Unfollowed types and actions are ignored. */
export async function applyEvent(
  sql: Db,
  event: WebhookEvent,
  context: WriteContext,
): Promise<EventResult> {
  if (!actions.has(event.action)) return result("ignored", null, zero());
  switch (event.type) {
    case "Project":
      return applyProject(sql, event, context);
    case "Initiative":
      return applyInitiative(sql, event, context);
    case "ProjectUpdate":
      return applyUpdate(sql, event, "projects", context);
    case "InitiativeUpdate":
      return applyUpdate(sql, event, "initiatives", context);
    default:
      return result("ignored", null, zero());
  }
}
