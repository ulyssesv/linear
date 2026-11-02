// Reading the mirror (MIRROR-R9, MIRROR-R14). Everything outside the sync code reads the
// mirror through these functions; apply.ts is the only writer.
import type { Db } from "./apply.ts";
import { type DbRow, tables } from "./tables.ts";
import {
  type Mirrored,
  type MirrorRecords,
  type MirrorType,
  mirrorTypes,
  type SyncSource,
} from "./types.ts";

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mirrored<T extends MirrorType>(type: T, row: DbRow): Mirrored<MirrorRecords[T]> {
  return {
    ...(tables[type].fromRow(row) as MirrorRecords[T]),
    removedAt: iso(row.removed_at),
    syncedAt: iso(row.synced_at) ?? "",
    syncedSource: row.synced_source as SyncSource,
    syncSeq: Number(row.sync_seq),
  };
}

export type ListOptions = {
  /** Include entities flagged removed. Archived entities are always included. */
  includeRemoved?: boolean;
  /** Only rows written after this sync_seq: what changed since a reader last looked. */
  afterSeq?: number;
};

/** Every mirrored entity of a type, ordered by name. */
export async function listMirrored<T extends MirrorType>(
  sql: Db,
  type: T,
  options: ListOptions = {},
): Promise<Mirrored<MirrorRecords[T]>[]> {
  const table = sql(tables[type].table);
  const rows = await sql`
    select * from ${table}
    where (${options.includeRemoved ?? false} or removed_at is null)
      and sync_seq > ${options.afterSeq ?? 0}
    order by name, id
  `;
  return rows.map((row) => mirrored(type, row));
}

/** One mirrored entity, removed or not, or null when the mirror has never held it. */
export async function getMirrored<T extends MirrorType>(
  sql: Db,
  type: T,
  id: string,
): Promise<Mirrored<MirrorRecords[T]> | null> {
  const [row] = await sql`select * from ${sql(tables[type].table)} where id = ${id}`;
  return row ? mirrored(type, row) : null;
}

/**
 * The ids of the public teams in the mirror (not removed; archived ones included): the
 * known public teams a webhook payload is scoped against (scope.ts).
 */
export async function publicTeamIds(sql: Db): Promise<Set<string>> {
  const rows = await sql`select id from mirror_teams where removed_at is null and not private`;
  return new Set(rows.map((row) => String(row.id)));
}

export type SourceStatus = {
  /** When the latest run of this source finished, whatever its outcome. */
  lastRunAt: string | null;
  lastOutcome: "ok" | "failed" | null;
  /** Start and end of the latest successful run: a reconcile window starts from it. */
  lastOkStartedAt: string | null;
  lastOkAt: string | null;
};

export type SyncStatus = {
  /** When a run last changed the mirror; null while it is empty. */
  lastChangeAt: string | null;
  /** The highest sync_seq in the mirror: it grows whenever a row is written. */
  version: number;
  bootstrap: SourceStatus;
  webhook: SourceStatus;
  reconcile: SourceStatus;
};

const sources: readonly SyncSource[] = ["bootstrap", "webhook", "reconcile"];

/** The highest sync_seq over every mirror table; 0 while the mirror is empty. */
async function mirrorVersion(sql: Db): Promise<number> {
  const seqs = mirrorTypes.map((type) => `select max(sync_seq) as seq from ${tables[type].table}`);
  const [version] = await sql.unsafe(
    `select max(seq) as version from (${seqs.join(" union all ")}) s`,
  );
  return Number(version?.version ?? 0);
}

/**
 * What an open sheet polls to learn that the mirror changed (MIRROR-R24): three index
 * lookups, cheap enough to ask every few seconds.
 */
export type MirrorFreshness = {
  /** As SyncStatus.version. */
  version: number;
  /**
   * The id of the latest bootstrap or reconcile run that changed rows, 0 before any. Such a
   * run writes many rows in one transaction, which may commit after a webhook with a
   * higher sync_seq; a reader that sees this id move re-reads in full rather than trusting
   * the rows after its last version.
   */
  bulkRun: number;
  /** As SyncStatus.lastChangeAt. */
  lastChangeAt: string | null;
};

export async function mirrorFreshness(sql: Db): Promise<MirrorFreshness> {
  const [log] = await sql`
    select
      (select max(finished_at) from mirror_sync_log where changed > 0) as last_change_at,
      (select max(id) from mirror_sync_log where changed > 0 and source <> 'webhook') as bulk_run
  `;
  return {
    version: await mirrorVersion(sql),
    bulkRun: Number(log?.bulk_run ?? 0),
    lastChangeAt: iso(log?.last_change_at),
  };
}

/** The entity types with a row written after `afterSeq`, in mirrorTypes order. */
export async function changedTypes(sql: Db, afterSeq: number): Promise<MirrorType[]> {
  const probes = mirrorTypes.map(
    (type) =>
      `select '${type}' as type where exists ` +
      `(select 1 from ${tables[type].table} where sync_seq > $1)`,
  );
  const rows = await sql.unsafe(probes.join(" union all "), [afterSeq]);
  const changed = new Set(rows.map((row) => String(row.type)));
  return mirrorTypes.filter((type) => changed.has(type));
}

/** When the mirror last changed and when each feeder last ran (MIRROR-R14). */
export async function syncStatus(sql: Db): Promise<SyncStatus> {
  const [changed] = await sql`
    select max(finished_at) as at from mirror_sync_log where changed > 0
  `;
  const perSource = await sql`
    select source,
      (array_agg(finished_at order by finished_at desc))[1] as last_run_at,
      (array_agg(outcome order by finished_at desc))[1] as last_outcome,
      (array_agg(started_at order by finished_at desc) filter (where outcome = 'ok'))[1]
        as last_ok_started_at,
      max(finished_at) filter (where outcome = 'ok') as last_ok_at
    from mirror_sync_log
    group by source
  `;
  const version = await mirrorVersion(sql);

  const bySource = new Map(perSource.map((row) => [String(row.source), row]));
  const status = (source: SyncSource): SourceStatus => {
    const row = bySource.get(source);
    return {
      lastRunAt: iso(row?.last_run_at),
      lastOutcome: (row?.last_outcome as SourceStatus["lastOutcome"]) ?? null,
      lastOkStartedAt: iso(row?.last_ok_started_at),
      lastOkAt: iso(row?.last_ok_at),
    };
  };
  const [bootstrap, webhook, reconcile] = sources.map(status) as [
    SourceStatus,
    SourceStatus,
    SourceStatus,
  ];
  return {
    lastChangeAt: iso(changed?.at),
    version,
    bootstrap,
    webhook,
    reconcile,
  };
}

/** Whether the mirror holds nothing yet: the reconcile pass bootstraps instead (T5). */
export async function mirrorIsEmpty(sql: Db): Promise<boolean> {
  const [row] = await sql`
    select not exists (select 1 from mirror_teams)
       and not exists (select 1 from mirror_projects)
       and not exists (select 1 from mirror_initiatives) as empty
  `;
  return Boolean(row?.empty);
}
