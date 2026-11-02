// Schema migrations (MIRROR-R5). Plain SQL files named `NNNN_slug.sql` in ./migrations,
// applied in version order, each in its own transaction together with its row in
// `schema_migrations`. A transaction-scoped advisory lock serialises concurrent runs, and
// each run re-reads what is applied under the lock, so running again, or twice at once,
// applies every migration exactly once. An applied migration must never be edited: the
// runner stores a checksum and refuses to continue when a file no longer matches.
import { createHash } from "node:crypto";
import type { Sql } from "./client.ts";

export type Migration = {
  /** `0001_init` */
  id: string;
  version: string;
  name: string;
  sql: string;
  checksum: string;
};

export type MigrateResult = { applied: string[] };

const fileName = /^(\d{4})_([a-z0-9_]+)\.sql$/;

// Arbitrary but fixed: every `migrate` of this application takes the same lock.
const lockKey = 7_165_105_097;

/** Turns `{ "<path>/0001_init.sql": "<sql>" }` into migrations ordered by version. */
export function parseMigrations(files: Readonly<Record<string, string>>): Migration[] {
  const migrations = Object.entries(files).map(([path, sql]): Migration => {
    const file = path.slice(path.lastIndexOf("/") + 1);
    const match = fileName.exec(file);
    if (!match) {
      throw new Error(`migration file "${file}" must be named NNNN_lower_snake_slug.sql`);
    }
    const [, version = "", name = ""] = match;
    const checksum = createHash("sha256").update(sql).digest("hex");
    return { id: `${version}_${name}`, version, name, sql, checksum };
  });
  migrations.sort((a, b) => a.version.localeCompare(b.version));
  migrations.forEach((migration, i) => {
    if (migration.version === migrations[i - 1]?.version) {
      throw new Error(`migration version ${migration.version} is used more than once`);
    }
  });
  return migrations;
}

/** Applies the migrations that the database has not applied yet, in order. */
export async function migrate(sql: Sql, migrations: readonly Migration[]): Promise<MigrateResult> {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${lockKey})`;
    await tx`
      create table if not exists schema_migrations (
        version text primary key,
        name text not null,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `;
  });

  const applied: string[] = [];
  for (const migration of migrations) {
    const ran = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${lockKey})`;
      const [row] = await tx`
        select checksum from schema_migrations where version = ${migration.version}
      `;
      if (row) {
        if (row.checksum !== migration.checksum) {
          throw new Error(
            `migration ${migration.id} changed after it was applied; add a new migration instead`,
          );
        }
        return false;
      }
      try {
        await tx.unsafe(migration.sql);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`migration ${migration.id} failed: ${reason}`, { cause: error });
      }
      await tx`
        insert into schema_migrations (version, name, checksum)
        values (${migration.version}, ${migration.name}, ${migration.checksum})
      `;
      return true;
    });
    if (ran) applied.push(migration.id);
  }
  return { applied };
}
