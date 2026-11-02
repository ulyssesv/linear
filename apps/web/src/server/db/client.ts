// Postgres access (MIRROR-R5, MIRROR-R6) through postgres.js, without an ORM.
//
// `database()` is the server's shared pool, opened on first use from DATABASE_URL, which
// the CLI validates before it serves. The pool lives on globalThis so that the CLI bundle
// and the server bundle, which each carry a copy of this module, share it and the CLI can
// close it on shutdown; it also survives module reloads in the dev server.
import postgres from "postgres";

export type Sql = postgres.Sql;

export function createSql(url: string, options: { max?: number } = {}): Sql {
  return postgres(url, {
    max: options.max ?? 10,
    // Fail fast: /readyz gives each check two seconds, `migrate` should not hang a Job.
    connect_timeout: 5,
    // `create table if not exists` and friends report notices; nobody reads them.
    onnotice: () => {},
  });
}

type Shared = { url: string; sql: Sql };
const key = "__sesvLinearDatabase";
const store = globalThis as typeof globalThis & { [key]?: Shared };

/** The shared pool for DATABASE_URL. Throws when it is not set. */
export function database(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const shared = store[key];
  if (shared?.url === url) return shared.sql;
  // Only tests change DATABASE_URL in a running process.
  if (shared) void shared.sql.end({ timeout: 0 });
  const sql = createSql(url);
  store[key] = { url, sql };
  return sql;
}

/** Closes the shared pool, letting running queries finish for a few seconds. */
export async function closeDatabase(): Promise<void> {
  const shared = store[key];
  if (!shared) return;
  delete store[key];
  await shared.sql.end({ timeout: 5 });
}

/** Resolves when the database answers a query, throws otherwise. */
export async function ping(sql: Sql): Promise<void> {
  await sql`select 1`;
}
