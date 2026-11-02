// The migration runner behind the `migrate` command (MIRROR-R5), against real Postgres.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSql, type Sql } from "../src/server/db/client.ts";
import { type Migration, migrate, parseMigrations } from "../src/server/db/migrate.ts";
import { migrations as shipped } from "../src/server/db/migrations.ts";
import type { ScratchDatabase } from "./scratch-db.ts";
import { scratchDatabase } from "./test-db.ts";

const files = {
  "./migrations/0002_widgets.sql": "create table widgets (id int primary key);",
  "./migrations/0001_init.sql": "-- marker",
  "./migrations/0010_gadgets.sql":
    "create table gadgets (id int primary key);\ninsert into gadgets values (1), (2);",
};

describe("parseMigrations", () => {
  it("MIRROR-R5 orders migrations by version and names them by file", () => {
    expect(parseMigrations(files).map((m) => m.id)).toEqual([
      "0001_init",
      "0002_widgets",
      "0010_gadgets",
    ]);
  });

  it.each([["0001-init.sql"], ["1_init.sql"], ["0001_Init.sql"], ["0001_init.txt"]])(
    "MIRROR-R5 rejects a file named %j",
    (name) => {
      expect(() => parseMigrations({ [`./migrations/${name}`]: "" })).toThrow(/migration file/);
    },
  );

  it("MIRROR-R5 rejects two migrations with one version", () => {
    expect(() =>
      parseMigrations({ "./migrations/0001_a.sql": "", "./migrations/0001_b.sql": "" }),
    ).toThrow(/0001.*more than once/);
  });

  it("MIRROR-R5 ships every file in src/server/db/migrations, in order", async () => {
    const dir = join(import.meta.dirname, "..", "src", "server", "db", "migrations");
    const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
    expect(names.length).toBeGreaterThan(0);
    expect(shipped.map((m) => `${m.id}.sql`)).toEqual(names);
  });
});

describe("migrate", () => {
  let db: ScratchDatabase;
  let sql: Sql;
  const pools: Sql[] = [];

  function pool() {
    const created = createSql(db.url, { max: 1 });
    pools.push(created);
    return created;
  }

  beforeEach(async () => {
    db = await scratchDatabase("migrate");
    sql = pool();
  });

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((p) => p.end({ timeout: 5 })));
    await db?.drop();
  });

  async function recorded() {
    return (await sql`select version, name from schema_migrations order by version`).map(
      (row) => `${row.version}_${row.name}`,
    );
  }

  it("MIRROR-R5 applies pending migrations in order and records each", async () => {
    const result = await migrate(sql, parseMigrations(files));
    expect(result.applied).toEqual(["0001_init", "0002_widgets", "0010_gadgets"]);
    expect(await recorded()).toEqual(["0001_init", "0002_widgets", "0010_gadgets"]);
    expect(await sql`select id from gadgets order by id`).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("MIRROR-R5 is safe to run again: a second run applies nothing", async () => {
    await migrate(sql, parseMigrations(files));
    const before = await sql`select version, applied_at from schema_migrations`;
    expect((await migrate(sql, parseMigrations(files))).applied).toEqual([]);
    expect(await sql`select version, applied_at from schema_migrations`).toEqual(before);
  });

  it("MIRROR-R5 applies only the migrations added since the last run", async () => {
    const all = parseMigrations(files);
    await migrate(sql, all.slice(0, 1));
    expect((await migrate(sql, all)).applied).toEqual(["0002_widgets", "0010_gadgets"]);
  });

  it("MIRROR-R5 rolls back a failing migration whole, keeps the earlier ones and names it", async () => {
    const broken: Migration[] = parseMigrations({
      ...files,
      "./migrations/0003_broken.sql": "create table broken (id int);\nselect * from missing;",
    });
    await expect(migrate(sql, broken)).rejects.toThrow(/0003_broken.*missing/);
    expect(await recorded()).toEqual(["0001_init", "0002_widgets"]);
    expect(await sql`select to_regclass('broken') as broken`).toEqual([{ broken: null }]);

    const fixed = parseMigrations({ ...files, "./migrations/0003_broken.sql": "select 1;" });
    expect((await migrate(sql, fixed)).applied).toEqual(["0003_broken", "0010_gadgets"]);
  });

  it("MIRROR-R5 refuses to run when an applied migration was edited", async () => {
    await migrate(sql, parseMigrations(files));
    const edited = parseMigrations({ ...files, "./migrations/0001_init.sql": "-- changed" });
    await expect(migrate(sql, edited)).rejects.toThrow(/0001_init.*changed after it was applied/);
  });

  it("MIRROR-R5 serialises concurrent runs so each migration is applied once", async () => {
    const slow = parseMigrations({
      ...files,
      "./migrations/0003_slow.sql": "select pg_sleep(0.2);\ncreate table slow (id int);",
    });
    const results = await Promise.all([pool(), pool(), pool()].map((p) => migrate(p, slow)));
    const applied = results.flatMap((r) => r.applied).sort();
    expect(applied).toEqual(["0001_init", "0002_widgets", "0003_slow", "0010_gadgets"]);
    expect(await recorded()).toEqual(applied);
  });

  it("MIRROR-R5 fails when the database cannot be reached", async () => {
    const unreachable = createSql("postgres://linear:linear@127.0.0.1:1/linear", { max: 1 });
    pools.push(unreachable);
    await expect(migrate(unreachable, parseMigrations(files))).rejects.toThrow();
  });
});
