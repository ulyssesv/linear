// Linear webhook payloads (MIRROR-R11): the envelope, and the normalisers that turn the
// `data` of a Project or Initiative event into the mirror's records (../mirror/types.ts),
// as listing.ts does for GraphQL nodes.
//
// Shapes follow https://linear.app/developers/webhooks and the webhook payload types of
// @linear/sdk 98.0.0 (EntityWebhookPayload, ProjectWebhookPayload, InitiativeWebhookPayload,
// ProjectUpdateWebhookPayload, InitiativeUpdateWebhookPayload). Where they differ from the
// GraphQL nodes the bootstrap reads:
// - References are flat ids (`statusId`, `leadId`, `teamIds`, `ownerId`, `leadTeamId`)
//   next to optional child objects (`status`, `lead`, `owner`); the ids win.
// - A project payload has no `progress` and no update body, only `lastUpdateId`; an
//   initiative payload has `lastUpdateId` and a `lastUpdate` without body or date. Both
//   keep what the mirror already holds: progress from the stored row, the latest update
//   from the stored row unless the payload says there is none. The update events set it.
// - `initiatives` on a project and `projects` on an initiative are optional child lists;
//   when absent the stored ids are kept.
// - An initiative payload has no `visibility`; the scope filter then decides on the lead
//   team alone (scope.ts).
// - `trashed: true` arrives as an update; like the listing, the mirror treats it as gone.
import { excerpt } from "../mirror/listing.ts";
import type { InitiativeCandidate } from "../mirror/scope.ts";
import type { Initiative, LatestUpdate, Project } from "../mirror/types.ts";

type Data = Record<string, unknown>;

/** The envelope of a data-change delivery. Only what the receiver reads is typed. */
export type WebhookEvent = {
  /** create, update or remove for data changes. */
  action: string;
  /** The entity type: Project, ProjectUpdate, Initiative, InitiativeUpdate, Issue, ... */
  type: string;
  data: Data;
  /** When Linear sent the delivery, epoch milliseconds; covered by the signature. */
  webhookTimestamp: unknown;
  organizationId?: string;
  webhookId?: string;
};

/** A signed payload that does not have the shape its type promises. */
export class PayloadError extends Error {}

const isObject = (value: unknown): value is Data =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Parses a delivery body. Throws PayloadError when it is not a webhook envelope. */
export function parseEvent(body: string): WebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new PayloadError("body is not JSON");
  }
  if (!isObject(parsed) || typeof parsed.action !== "string" || typeof parsed.type !== "string") {
    throw new PayloadError("body is not a webhook envelope");
  }
  return {
    action: parsed.action,
    type: parsed.type,
    data: isObject(parsed.data) ? parsed.data : {},
    webhookTimestamp: parsed.webhookTimestamp,
    organizationId: typeof parsed.organizationId === "string" ? parsed.organizationId : undefined,
    webhookId: typeof parsed.webhookId === "string" ? parsed.webhookId : undefined,
  };
}

function required(data: Data, field: string): string {
  const value = data[field];
  if (typeof value !== "string" || value === "") {
    throw new PayloadError(`data.${field} is missing`);
  }
  return value;
}

const str = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));
const strOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const num = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

/** A flat id field, or the id of the child object next to it. */
function flatRef(data: Data, idField: string, childField: string): string | null {
  if (idField in data) return strOrNull(data[idField]);
  const child = data[childField];
  return isObject(child) ? strOrNull(child.id) : null;
}

/** The ids of an optional child list, or `fallback` when the payload leaves it out. */
function childIds(value: unknown, fallback: readonly string[] | undefined): string[] {
  if (!Array.isArray(value)) return [...(fallback ?? [])];
  return value.flatMap((child) =>
    isObject(child) && typeof child.id === "string" ? [child.id] : [],
  );
}

/**
 * The latest update a payload implies: none when `lastUpdateId` is null, otherwise the
 * stored one, which the update events keep current.
 */
function keptLatestUpdate(
  data: Data,
  stored: LatestUpdate | null | undefined,
): LatestUpdate | null {
  if ("lastUpdateId" in data && (data.lastUpdateId === null || data.lastUpdateId === undefined)) {
    return null;
  }
  return stored ?? null;
}

function tracked(data: Data) {
  return {
    id: required(data, "id"),
    updatedAt: required(data, "updatedAt"),
    archivedAt: strOrNull(data.archivedAt),
  };
}

/** Whether Linear has trashed the entity: the mirror treats it as removed. */
export function isTrashed(data: Data): boolean {
  return data.trashed === true;
}

/** A Project event's data as a mirror record, completed from the stored row. */
export function projectFromPayload(data: Data, stored: Project | null): Project {
  return {
    ...tracked(data),
    name: str(data.name),
    slugId: str(data.slugId),
    identifier: strOrNull(data.identifier),
    url: str(data.url),
    statusId: flatRef(data, "statusId", "status"),
    leadId: flatRef(data, "leadId", "lead"),
    startDate: strOrNull(data.startDate),
    targetDate: strOrNull(data.targetDate),
    priority: num(data.priority),
    health: strOrNull(data.health),
    progress: stored?.progress ?? 0,
    teamIds: list(data.teamIds),
    initiativeIds: childIds(data.initiatives, stored?.initiativeIds),
    labelIds: list(data.labelIds),
    lastUpdate: keptLatestUpdate(data, stored?.lastUpdate),
    createdAt: str(data.createdAt),
    completedAt: strOrNull(data.completedAt),
    canceledAt: strOrNull(data.canceledAt),
  };
}

/** An Initiative event's data as a scope candidate, completed from the stored row. */
export function initiativeFromPayload(data: Data, stored: Initiative | null): InitiativeCandidate {
  const candidate: InitiativeCandidate = {
    ...tracked(data),
    name: str(data.name),
    slugId: str(data.slugId),
    identifier: strOrNull(data.identifier),
    url: str(data.url),
    status: str(data.status),
    ownerId: flatRef(data, "ownerId", "owner"),
    leadTeamId: flatRef(data, "leadTeamId", "leadTeam"),
    targetDate: strOrNull(data.targetDate),
    priority: num(data.priority),
    health: strOrNull(data.health),
    projectIds: childIds(data.projects, stored?.projectIds),
    labelIds: list(data.labelIds),
    lastUpdate: keptLatestUpdate(data, stored?.lastUpdate),
    createdAt: str(data.createdAt),
    completedAt: strOrNull(data.completedAt),
  };
  // Only when the payload carries it; today's payloads do not.
  if ("visibility" in data) candidate.visibility = strOrNull(data.visibility);
  return candidate;
}

export type UpdateEvent = {
  /** The project or initiative the update belongs to. */
  parentId: string;
  update: LatestUpdate;
  /** Archived or trashed: no longer a latest update. */
  gone: boolean;
};

/** A ProjectUpdate or InitiativeUpdate event's data. */
export function updateFromPayload(data: Data, parent: "project" | "initiative"): UpdateEvent {
  const parentId = flatRef(data, `${parent}Id`, parent);
  if (!parentId) throw new PayloadError(`data.${parent}Id is missing`);
  return {
    parentId,
    update: {
      id: required(data, "id"),
      excerpt: excerpt(str(data.body)),
      health: strOrNull(data.health),
      createdAt: required(data, "createdAt"),
    },
    gone: strOrNull(data.archivedAt) !== null || isTrashed(data),
  };
}
