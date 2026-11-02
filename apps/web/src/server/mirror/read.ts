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
  const seqs = mirrorTypes.map((type) => `select max(sync_seq) as seq from ${tables[type].table}`);
  const [version] = await sql.unsafe(
    `select max(seq) as version from (${seqs.join(" union all ")}) s`,
  );

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
    version: Number(version?.version ?? 0),
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
