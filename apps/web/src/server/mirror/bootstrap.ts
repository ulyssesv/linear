// The bootstrap (MIRROR-R10): fills the mirror by paging through every entity type, and on
// a filled mirror applies only what changed in Linear and flags what Linear no longer
// returns as removed.
//
// It reads everything first and writes after, in one transaction with its sync-log entry:
// a failed request leaves the mirror as it was, and removal flags are only set after a
// complete, successful listing. Types are listed and applied reference data first (teams,
// users, statuses, labels), then projects and initiatives, which the scope filter checks
// against the public teams of the same pass (MIRROR-R12).
//
// Not wired to a command yet: the reconcile pass (T5) runs it when the mirror is empty
// (read.ts mirrorIsEmpty), and it can be run on demand from there.
import type { Sql } from "../db/client.ts";
import type { LinearClient } from "../linear/client.ts";
import {
  type ApplyCounts,
  applyRecords,
  markMissingRemoved,
  recordSyncRun,
  type WriteContext,
} from "./apply.ts";
import {
  initiativeFromNode,
  initiativeLabelFromNode,
  initiativeStatuses,
  type ListedType,
  listAll,
  notTrashed,
  projectFromNode,
  projectLabelFromNode,
  projectStatusFromNode,
  teamFromNode,
  userFromNode,
} from "./listing.ts";
import { type ScopeCandidates, scopeRecords, scopeTeams } from "./scope.ts";
import { type MirrorRecords, type MirrorType, mirrorTypes } from "./types.ts";

export type TypeCounts = ApplyCounts & {
  /** Flagged removed because Linear no longer returned them. */
  removed: number;
  /** Returned by Linear but out of scope (MIRROR-R12), so never written. */
  dropped: number;
};

export type BootstrapResult = {
  startedAt: Date;
  finishedAt: Date;
  /** Rows inserted, updated or flagged removed. */
  changed: number;
  counts: Record<MirrorType, TypeCounts>;
};

export type BootstrapOptions = {
  sql: Sql;
  client: LinearClient;
  /** Epoch milliseconds; the clock the mirror stamps its writes with. */
  now?: () => number;
};

type Node = Record<string, unknown>;

const normalisers: { [T in Exclude<ListedType, "teams">]: (node: Node) => ScopeCandidates[T] } = {
  users: userFromNode,
  projectStatuses: projectStatusFromNode,
  projectLabels: projectLabelFromNode,
  initiativeLabels: initiativeLabelFromNode,
  projects: projectFromNode,
  initiatives: initiativeFromNode,
};

const trashable: ReadonlySet<ListedType> = new Set(["projects", "initiatives"]);

type Listed = { [T in MirrorType]: { kept: MirrorRecords[T][]; dropped: number } };

/** Lists every type from Linear and applies the scope filter. Writes nothing. */
async function listWorkspace(client: LinearClient): Promise<Listed> {
  const teamNodes = (await listAll(client, "teams")).map(teamFromNode);
  const teams = scopeTeams(teamNodes);
  const publicTeamIds = new Set(teams.map((team) => team.id));

  const listed = async <T extends Exclude<ListedType, "teams">>(type: T) => {
    const nodes = (await listAll(client, type)).filter(
      (node) => !trashable.has(type) || notTrashed(node),
    );
    const candidates = nodes.map(normalisers[type]) as ScopeCandidates[T][];
    const kept = scopeRecords(type, candidates, publicTeamIds);
    return { kept, dropped: candidates.length - kept.length };
  };

  // One after the other: the client backs off per request, and the budget assumes no
  // parallel burst.
  const users = await listed("users");
  const projectStatuses = await listed("projectStatuses");
  const projectLabels = await listed("projectLabels");
  const initiativeLabels = await listed("initiativeLabels");
  const projects = await listed("projects");
  const initiatives = await listed("initiatives");
  return {
    teams: { kept: teams, dropped: teamNodes.length - teams.length },
    users,
    projectStatuses,
    initiativeStatuses: { kept: [...initiativeStatuses], dropped: 0 },
    projectLabels,
    initiativeLabels,
    projects,
    initiatives,
  };
}

/** Fills or refreshes the mirror from a full listing of the workspace. */
export async function bootstrap(options: BootstrapOptions): Promise<BootstrapResult> {
  const { sql, client } = options;
  const now = () => new Date((options.now ?? Date.now)());
  const startedAt = now();
  try {
    const listed = await listWorkspace(client);
    return await sql.begin(async (tx) => {
      const context: WriteContext = { source: "bootstrap", at: now() };
      const counts = {} as Record<MirrorType, TypeCounts>;
      let changed = 0;
      for (const type of mirrorTypes) {
        const { kept, dropped } = listed[type];
        const applied = await applyRecords(tx, type, kept, context);
        const removed = await markMissingRemoved(
          tx,
          type,
          kept.map((record) => record.id),
          { ...context, since: startedAt },
        );
        counts[type] = { ...applied, removed, dropped };
        changed += applied.inserted + applied.updated + removed;
      }
      const finishedAt = now();
      await recordSyncRun(tx, {
        source: "bootstrap",
        startedAt,
        finishedAt,
        outcome: "ok",
        changed,
        counts,
      });
      return { startedAt, finishedAt, changed, counts };
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await recordSyncRun(sql, {
      source: "bootstrap",
      startedAt,
      finishedAt: now(),
      outcome: "failed",
      changed: 0,
      error: reason.slice(0, 1000),
    }).catch(() => {});
    throw error;
  }
}
