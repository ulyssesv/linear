// The only writer of the mirror (MIRROR-R9). Feeders (bootstrap.ts here, the webhook
// receiver and the reconcile pass later) normalise what Linear sends, pass it through
// scope.ts, and hand it to these functions; nothing else in the server inserts, updates or
// deletes a mirror row. test/mirror-writers.test.ts fails the build when another file does.
//
// - applyRecords upserts by id and is idempotent: a payload no newer than the row (by
//   Linear's updatedAt) changes nothing, so replays, overlapping reconcile windows and
//   webhooks racing a bootstrap settle on the newest version (MIRROR-R10).
// - Removal is a flag. markRemoved and markMissingRemoved set removed_at and never delete;
//   a removed entity that Linear returns again comes back (MIRROR-R10).
// - recordSyncRun writes the sync log: every run's source, time, outcome and counts
//   (MIRROR-R14). Each written row also carries its source and time.
import type postgres from "postgres";
import { type Row, tables } from "./tables.ts";
import type { MirrorRecords, MirrorType, SyncSource } from "./types.ts";

/** postgres.js inside or outside a transaction. */
export type Db = postgres.ISql;

export type WriteContext = {
  source: SyncSource;
  /** The time the mirror records for the write. */
  at: Date;
};

export type ApplyCounts = { inserted: number; updated: number; unchanged: number };

// Postgres takes at most 65,535 parameters per statement; the widest table has 30 columns.
const chunkSize = 500;

/** The newest payload per id, so one statement never touches a row twice. */
function newestById<T extends { id: string; updatedAt: string }>(records: readonly T[]): T[] {
  const newest = new Map<string, T>();
  for (const record of records) {
    const seen = newest.get(record.id);
    if (!seen || Date.parse(record.updatedAt) > Date.parse(seen.updatedAt)) {
      newest.set(record.id, record);
    }
  }
  return [...newest.values()];
}

/**
 * Upserts records of one type. A row changes only when the payload is newer than it, or
 * when the row is flagged removed and the payload is at least as new; then removed_at is
 * cleared and the row is stamped with the source and time.
 */
export async function applyRecords<T extends MirrorType>(
  sql: Db,
  type: T,
  records: readonly MirrorRecords[T][],
  context: WriteContext,
): Promise<ApplyCounts> {
  const spec = tables[type];
  const unique = newestById(records);
  const counts: ApplyCounts = { inserted: 0, updated: 0, unchanged: 0 };
  const columns = [...spec.columns, "synced_at", "synced_source"];
  const updates = [...spec.columns.filter((c) => c !== "id"), "synced_at", "synced_source"]
    .map((c) => sql`${sql(c)} = excluded.${sql(c)}`)
    .reduce((list, item) => sql`${list}, ${item}`);
  const table = sql(spec.table);

  for (let i = 0; i < unique.length; i += chunkSize) {
    const rows: Row[] = unique.slice(i, i + chunkSize).map((record) => ({
      ...spec.toRow(record),
      synced_at: context.at,
      synced_source: context.source,
    }));
    const written = await sql`
      insert into ${table} ${sql(rows, columns)}
      on conflict (id) do update set
        ${updates},
        removed_at = null,
        sync_seq = nextval('mirror_sync_seq')
      where excluded.updated_at > ${table}.updated_at
         or (${table}.removed_at is not null and excluded.updated_at >= ${table}.updated_at)
      returning (xmax = 0) as inserted
    `;
    const inserted = written.filter((row) => row.inserted).length;
    counts.inserted += inserted;
    counts.updated += written.length - inserted;
    counts.unchanged += rows.length - written.length;
  }
  return counts;
}

/** Flags these entities as removed (a webhook remove event). Returns how many changed. */
export async function markRemoved(
  sql: Db,
  type: MirrorType,
  ids: readonly string[],
  context: WriteContext,
): Promise<number> {
  if (ids.length === 0) return 0;
  const table = sql(tables[type].table);
  const rows = await sql`
    update ${table} set
      removed_at = ${context.at},
      synced_at = ${context.at},
      synced_source = ${context.source},
      sync_seq = nextval('mirror_sync_seq')
    where id = any(${ids as string[]}) and removed_at is null
    returning id
  `;
  return rows.length;
}

/**
 * Flags as removed every entity of a type that a complete listing did not return. Rows
 * written at or after `since` (the start of the listing) are left alone: a webhook may
 * have added them while the listing was paging. Returns how many changed.
 */
export async function markMissingRemoved(
  sql: Db,
  type: MirrorType,
  returnedIds: readonly string[],
  context: WriteContext & { since: Date },
): Promise<number> {
  const table = sql(tables[type].table);
  const rows = await sql`
    update ${table} set
      removed_at = ${context.at},
      synced_at = ${context.at},
      synced_source = ${context.source},
      sync_seq = nextval('mirror_sync_seq')
    where removed_at is null
      and synced_at < ${context.since}
      and not (id = any(${returnedIds as string[]}))
    returning id
  `;
  return rows.length;
}

export type SyncRun = {
  source: SyncSource;
  startedAt: Date;
  finishedAt: Date;
  outcome: "ok" | "failed";
  /** Rows inserted, updated or flagged removed. */
  changed: number;
  /** Free-form breakdown, per entity type for a bootstrap or reconcile. */
  counts?: Record<string, unknown>;
  error?: string;
};

/** Records one feeder run in the sync log (MIRROR-R14). */
export async function recordSyncRun(sql: Db, run: SyncRun): Promise<void> {
  await sql`
    insert into mirror_sync_log (source, started_at, finished_at, outcome, changed, counts, error)
    values (
      ${run.source}, ${run.startedAt}, ${run.finishedAt}, ${run.outcome}, ${run.changed},
      ${sql.json((run.counts ?? {}) as postgres.JSONValue)}, ${run.error ?? null}
    )
  `;
}
