// The reconcile pass (MIRROR-R13, MIRROR-R14): bounds the mirror's staleness whatever
// happened to the webhooks. The image's `scheduler` command runs one pass (scheduler.ts).
//
// One pass:
// - Takes a Postgres advisory lock, so two passes never write at once. A pass that finds
//   the lock taken does nothing and reports "skipped"; the scheduler exits 0 for it, since
//   the running pass does the work.
// - Bootstraps instead when the mirror is empty or has never had a successful bootstrap or
//   reconcile to start a window from (bootstrap.ts).
// - Otherwise lists from Linear, then writes everything in one transaction with its
//   sync-log entry, like the bootstrap: a failed request leaves the mirror as it was and
//   the failure is recorded.
//
// What it lists:
// - Reference data (teams, users, project statuses, project and initiative labels) in
//   full every pass: Linear sends no webhook for them, and they are a few requests.
// - Projects and initiatives Linear changed at or after `since`: the start of the latest
//   successful bootstrap or reconcile, minus an overlap (reconcileOverlapMs). Starting
//   from the previous pass's start rather than its end covers whatever changed while it was
//   paging. The overlap covers the difference between this server's clock, which stamps a
//   pass, and Linear's, which stamps updatedAt, and a change Linear commits with an
//   updatedAt slightly before it becomes visible to a listing. A webhook that never
//   arrived is covered by the window itself: every change since the last pass is listed
//   again, webhook or not. Re-applying an entity the window already covered changes
//   nothing (apply.ts compares updatedAt).
// - The id of every project and initiative (`id trashed`, 250 a page) to detect removals:
//   a deleted or trashed entity has no updatedAt to filter on and simply stops being
//   returned. Every mirrored project or initiative missing from that listing, trashed, or
//   returned by the changed listing but out of scope (MIRROR-R12), is flagged removed in
//   the same pass. Rows a webhook wrote after the pass started are left alone.
// - When a team that the mirror holds leaves the listing (deleted, or made private), the
//   projects and initiatives of this pass are listed in full instead of since `since`, so
//   the scope filter re-checks every one of them against the new set of public teams.
import type { Sql } from "../db/client.ts";
import type { LinearClient } from "../linear/client.ts";
import { type ApplyCounts, applyRecords, markMissingRemoved, recordSyncRun } from "./apply.ts";
import { bootstrap, type TypeCounts } from "./bootstrap.ts";
import {
  initiativeFromNode,
  initiativeLabelFromNode,
  initiativeStatuses,
  listAll,
  listReconcile,
  notTrashed,
  projectFromNode,
  projectLabelFromNode,
  projectStatusFromNode,
  teamFromNode,
  userFromNode,
} from "./listing.ts";
import { mirrorIsEmpty, publicTeamIds, syncStatus } from "./read.ts";
import { type ScopeCandidates, scopeRecords, scopeTeams } from "./scope.ts";
import { type MirrorRecords, type MirrorType, mirrorTypes } from "./types.ts";

/** How far before the last successful pass's start a window begins. */
export const reconcileOverlapMs = 15 * 60 * 1000;

/** Arbitrary but fixed, and distinct from `migrate`'s: every sync pass takes this lock. */
export const syncPassLockKey = 7_165_105_098;

export type PassSource = "bootstrap" | "reconcile";

export type PassResult =
  | {
      outcome: "ok";
      source: PassSource;
      startedAt: Date;
      finishedAt: Date;
      /** Start of the window of changed projects and initiatives; null for a full listing. */
      since: Date | null;
      /** Rows inserted, updated or flagged removed. */
      changed: number;
      counts: Record<MirrorType, TypeCounts>;
    }
  | {
      outcome: "failed";
      source: PassSource;
      startedAt: Date;
      finishedAt: Date;
      error: string;
    }
  | { outcome: "skipped"; reason: string };

export type PassOptions = {
  sql: Sql;
  client: LinearClient;
  /** Epoch milliseconds; the clock the mirror stamps its writes with. */
  now?: () => number;
  overlapMs?: number;
};

type Node = Record<string, unknown>;
type Listed = { [T in MirrorType]: { kept: MirrorRecords[T][]; dropped: number } };
type Window = { since: Date | null };

/** Runs one pass under the advisory lock. Never throws for a failure of the pass itself. */
export async function runSyncPass(options: PassOptions): Promise<PassResult> {
  const { sql } = options;
  const lock = await sql.reserve();
  try {
    const [row] = await lock`select pg_try_advisory_lock(${syncPassLockKey}) as locked`;
    if (!row?.locked) return { outcome: "skipped", reason: "another pass is running" };
    try {
      return await pass(options);
    } finally {
      await lock`select pg_advisory_unlock(${syncPassLockKey})`;
    }
  } finally {
    lock.release();
  }
}

async function pass(options: PassOptions): Promise<PassResult> {
  const { sql, client } = options;
  const clock = options.now ?? Date.now;
  const status = await syncStatus(sql);
  const baseline = [status.reconcile.lastOkStartedAt, status.bootstrap.lastOkStartedAt]
    .filter((at): at is string => at !== null)
    .map((at) => Date.parse(at))
    .reduce((latest, at) => Math.max(latest, at), Number.NEGATIVE_INFINITY);
  const source: PassSource =
    (await mirrorIsEmpty(sql)) || !Number.isFinite(baseline) ? "bootstrap" : "reconcile";
  const startedAt = new Date(clock());
  try {
    if (source === "bootstrap") {
      const result = await bootstrap({ sql, client, now: options.now });
      return { outcome: "ok", source, since: null, ...result };
    }
    const since = new Date(baseline - (options.overlapMs ?? reconcileOverlapMs));
    return { outcome: "ok", source, ...(await reconcile({ ...options, since })) };
  } catch (error) {
    return {
      outcome: "failed",
      source,
      startedAt,
      finishedAt: new Date(clock()),
      error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    };
  }
}

export type ReconcileResult = {
  startedAt: Date;
  finishedAt: Date;
  since: Date | null;
  changed: number;
  counts: Record<MirrorType, TypeCounts>;
};

/**
 * Applies what changed in Linear since `since` and flags what Linear no longer returns.
 * Records the run, failed or not, in the sync log with source `reconcile`.
 */
export async function reconcile(
  options: Omit<PassOptions, "overlapMs"> & { since: Date },
): Promise<ReconcileResult> {
  const { sql, client } = options;
  const now = () => new Date((options.now ?? Date.now)());
  const startedAt = now();
  try {
    const { listed, present, window } = await listChanges(sql, client, options.since);
    return await sql.begin(async (tx) => {
      const context = { source: "reconcile" as const, at: now() };
      const counts = {} as Record<MirrorType, TypeCounts>;
      let changed = 0;
      for (const type of mirrorTypes) {
        const { kept, dropped } = listed[type];
        const applied: ApplyCounts = await applyRecords(tx, type, kept, context);
        // Reference data is listed in full; projects and initiatives by the id listing.
        const returned = present[type] ?? kept.map((record) => record.id);
        const removed = await markMissingRemoved(tx, type, returned, {
          ...context,
          since: startedAt,
        });
        counts[type] = { ...applied, removed, dropped };
        changed += applied.inserted + applied.updated + removed;
      }
      const finishedAt = now();
      await recordSyncRun(tx, {
        source: "reconcile",
        startedAt,
        finishedAt,
        outcome: "ok",
        changed,
        counts,
      });
      return { startedAt, finishedAt, since: window.since, changed, counts };
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await recordSyncRun(sql, {
      source: "reconcile",
      startedAt,
      finishedAt: now(),
      outcome: "failed",
      changed: 0,
      error: reason.slice(0, 1000),
    }).catch(() => {});
    throw error;
  }
}

type ReferenceType = "users" | "projectStatuses" | "projectLabels" | "initiativeLabels";

const referenceNormalisers: { [T in ReferenceType]: (node: Node) => ScopeCandidates[T] } = {
  users: userFromNode,
  projectStatuses: projectStatusFromNode,
  projectLabels: projectLabelFromNode,
  initiativeLabels: initiativeLabelFromNode,
};

/**
 * Lists what this pass applies, scoped, and for projects and initiatives the ids Linear
 * still returns in scope. Writes nothing.
 */
async function listChanges(
  sql: Sql,
  client: LinearClient,
  since: Date,
): Promise<{
  listed: Listed;
  present: Partial<Record<MirrorType, string[]>>;
  window: Window;
}> {
  const teamNodes = (await listAll(client, "teams")).map(teamFromNode);
  const teams = scopeTeams(teamNodes);
  const publicIds = new Set(teams.map((team) => team.id));
  const mirrored = await publicTeamIds(sql);
  const teamLeft = [...mirrored].some((id) => !publicIds.has(id));
  const window: Window = { since: teamLeft ? null : since };

  const scoped = <T extends Exclude<MirrorType, "teams">>(
    type: T,
    candidates: ScopeCandidates[T][],
  ) => {
    const kept = scopeRecords(type, candidates, publicIds);
    return { kept, dropped: candidates.length - kept.length };
  };
  const reference = async <T extends ReferenceType>(type: T) => {
    const normalise: (node: Node) => ScopeCandidates[T] = referenceNormalisers[type];
    return scoped(type, (await listAll(client, type)).map(normalise));
  };

  // One request after the other: the client backs off per request, and the budget
  // assumes no parallel burst.
  const users = await reference("users");
  const projectStatuses = await reference("projectStatuses");
  const projectLabels = await reference("projectLabels");
  const initiativeLabels = await reference("initiativeLabels");

  const entities = async <T extends "projects" | "initiatives">(
    type: T,
    fromNode: (node: Node) => ScopeCandidates[T],
  ) => {
    const changedQuery = type === "projects" ? "changedProjects" : "changedInitiatives";
    const idsQuery = type === "projects" ? "projectIds" : "initiativeIds";
    const nodes =
      window.since === null
        ? await listAll(client, type)
        : await listReconcile(client, changedQuery, window.since);
    const live = nodes.filter(notTrashed);
    const { kept, dropped } = scoped(type, live.map(fromNode) as ScopeCandidates[T][]);
    const keptIds = new Set(kept.map((record) => record.id));
    const outOfScope = new Set(
      live.map((node) => String(node.id)).filter((id) => !keptIds.has(id)),
    );
    const all = window.since === null ? nodes : await listReconcile(client, idsQuery);
    const present = all
      .filter(notTrashed)
      .map((node) => String(node.id))
      .filter((id) => !outOfScope.has(id));
    return { listed: { kept, dropped }, present };
  };
  const projects = await entities("projects", projectFromNode);
  const initiatives = await entities("initiatives", initiativeFromNode);

  return {
    listed: {
      teams: { kept: teams, dropped: teamNodes.length - teams.length },
      users,
      projectStatuses,
      initiativeStatuses: { kept: [...initiativeStatuses], dropped: 0 },
      projectLabels,
      initiativeLabels,
      projects: projects.listed,
      initiatives: initiatives.listed,
    },
    present: { projects: projects.present, initiatives: initiatives.present },
    window,
  };
}
