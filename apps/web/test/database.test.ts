// The shared database handle and its readiness check (MIRROR-R6), against real Postgres.
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, database } from "../src/server/db/client.ts";
import { readiness } from "../src/server/readiness.ts";
import { testDatabaseUrl } from "./test-db.ts";

const unreachable = "postgres://linear:linear@127.0.0.1:1/linear";

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeDatabase();
});

describe("database()", () => {
  it("MIRROR-R6 connects to DATABASE_URL and reuses one pool", async () => {
    vi.stubEnv("DATABASE_URL", testDatabaseUrl());
    const sql = database();
    expect(database()).toBe(sql);
    expect(await sql`select 1 as one`).toEqual([{ one: 1 }]);
  });

  it("MIRROR-R6 throws when DATABASE_URL is not set", () => {
    vi.stubEnv("DATABASE_URL", undefined);
    expect(() => database()).toThrow(/DATABASE_URL is not set/);
  });
});

describe("/readyz database check", () => {
  it("MIRROR-R6 is registered and passes when the database answers", async () => {
    vi.stubEnv("DATABASE_URL", testDatabaseUrl());
    expect(await readiness.run()).toEqual({ ok: true, checks: { database: { status: "ok" } } });
  });

  it("MIRROR-R6 fails when the database cannot be reached", async () => {
    vi.stubEnv("DATABASE_URL", unreachable);
    const report = await readiness.run();
    expect(report.ok).toBe(false);
    expect(report.checks.database).toEqual({ status: "fail", error: expect.any(String) });
  });

  it("MIRROR-R6 fails when no database is configured", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    expect(await readiness.run()).toEqual({
      ok: false,
      checks: { database: { status: "fail", error: "DATABASE_URL is not set" } },
    });
  });
});
