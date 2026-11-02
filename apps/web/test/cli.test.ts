import { describe, expect, it, vi } from "vitest";
import { type MigrateCommand, run, type SchedulerCommand } from "../src/cli.ts";
import type { Env } from "../src/server/env.ts";
import type { SchedulerResult } from "../src/server/mirror/scheduler.ts";
import { serveEnv as required } from "./serve-env.ts";

const DATABASE_URL = required.DATABASE_URL;

function io(env: Record<string, string | undefined> = required) {
  const out: string[] = [];
  const err: string[] = [];
  const serve = vi.fn(async (_env: Env) => {});
  const migrate = vi.fn<MigrateCommand>(async () => ({ applied: [] }));
  const scheduler = vi.fn<SchedulerCommand>(async () => okPass);
  return {
    io: {
      env,
      stdout: (l: string) => out.push(l),
      stderr: (l: string) => err.push(l),
      serve,
      migrate,
      scheduler,
    },
    out,
    err,
    serve,
    migrate,
    scheduler,
  };
}

const schedulerEnv = {
  DATABASE_URL,
  LINEAR_CLIENT_ID: required.LINEAR_CLIENT_ID,
  LINEAR_CLIENT_SECRET: required.LINEAR_CLIENT_SECRET,
  TOKEN_ENCRYPTION_KEY: required.TOKEN_ENCRYPTION_KEY,
};

const typeCounts = { inserted: 0, updated: 1, unchanged: 2, removed: 1, dropped: 0 };
const okPass: SchedulerResult = {
  outcome: "ok",
  source: "reconcile",
  startedAt: new Date("2026-11-02T10:00:00.000Z"),
  finishedAt: new Date("2026-11-02T10:00:02.500Z"),
  since: new Date("2026-11-02T09:35:00.000Z"),
  changed: 2,
  counts: Object.fromEntries(
    [
      "teams",
      "users",
      "projectStatuses",
      "initiativeStatuses",
      "projectLabels",
      "initiativeLabels",
      "projects",
      "initiatives",
    ].map((type) => [type, typeCounts]),
  ) as Extract<SchedulerResult, { outcome: "ok" }>["counts"],
  linear: { requests: 10, complexity: 8_345 },
};

describe("CLI entrypoint", () => {
  it("SEED-R24 serves by default", async () => {
    const t = io();
    expect(await run([], t.io)).toBeUndefined();
    expect(t.serve).toHaveBeenCalledWith({
      PORT: 3000,
      PUBLIC_URL: "http://localhost:3000",
      ...required,
    });
  });

  it("SEED-R24 serve starts the web server with the validated environment", async () => {
    const t = io({ ...required, PORT: "8080" });
    expect(await run(["serve"], t.io)).toBeUndefined();
    expect(t.serve).toHaveBeenCalledWith({
      PORT: 8080,
      PUBLIC_URL: "http://localhost:3000",
      ...required,
    });
  });

  it("SEED-R22 serve exits non-zero listing the invalid variables", async () => {
    const t = io({ ...required, PORT: "nope", PUBLIC_URL: "nope" });
    expect(await run(["serve"], t.io)).toBe(1);
    expect(t.serve).not.toHaveBeenCalled();
    const message = t.err.join("\n");
    expect(message).toMatch(/PORT: /);
    expect(message).toMatch(/PUBLIC_URL: /);
  });

  it("MIRROR-R7 serve exits non-zero listing every missing name without printing values", async () => {
    const t = io({ ...required, LINEAR_CLIENT_SECRET: undefined, SESSION_SECRET: "hunter2" });
    expect(await run(["serve"], t.io)).toBe(1);
    expect(t.serve).not.toHaveBeenCalled();
    const message = t.err.join("\n");
    expect(message).toMatch(/LINEAR_CLIENT_SECRET: is required/);
    expect(message).toMatch(/SESSION_SECRET: must be at least 32 characters/);
    expect(message).not.toMatch(/hunter2|test-client-id|postgres:/);
  });

  it("MIRROR-R7 migrate needs only DATABASE_URL", async () => {
    const t = io({ DATABASE_URL });
    expect(await run(["migrate"], t.io)).toBe(0);
    expect(t.migrate).toHaveBeenCalledWith({ DATABASE_URL });
  });

  it("MIRROR-R6 serve requires DATABASE_URL, so the server never starts without a database", async () => {
    const t = io({});
    expect(await run(["serve"], t.io)).toBe(1);
    expect(t.serve).not.toHaveBeenCalled();
    expect(t.err.join("\n")).toMatch(/DATABASE_URL: is required/);
  });

  it("MIRROR-R13 scheduler runs one pass, exits 0 and logs one JSON line with its counts", async () => {
    const t = io();
    expect(await run(["scheduler"], t.io)).toBe(0);
    expect(t.scheduler).toHaveBeenCalledWith(schedulerEnv);
    expect(t.serve).not.toHaveBeenCalled();
    expect(t.out).toHaveLength(1);
    expect(JSON.parse(t.out[0] ?? "")).toEqual({
      event: "scheduler",
      outcome: "ok",
      source: "reconcile",
      startedAt: "2026-11-02T10:00:00.000Z",
      finishedAt: "2026-11-02T10:00:02.500Z",
      durationMs: 2500,
      since: "2026-11-02T09:35:00.000Z",
      changed: 2,
      counts: expect.objectContaining({ projects: typeCounts }),
      linear: { requests: 10, complexity: 8_345 },
      prunedDeliveries: null,
    });
    expect(t.err).toEqual([]);
  });

  it("MIRROR-R13 scheduler exits 0 when another pass holds the lock", async () => {
    const t = io();
    t.scheduler.mockResolvedValueOnce({
      outcome: "skipped",
      reason: "another pass is running",
      linear: { requests: 0, complexity: 0 },
    });
    expect(await run(["scheduler"], t.io)).toBe(0);
    expect(JSON.parse(t.out[0] ?? "")).toMatchObject({
      outcome: "skipped",
      reason: "another pass is running",
    });
  });

  it("MIRROR-R13 scheduler exits 1 when the pass fails, logging why on stderr", async () => {
    const t = io();
    t.scheduler.mockResolvedValueOnce({
      outcome: "failed",
      source: "reconcile",
      startedAt: new Date("2026-11-02T10:00:00.000Z"),
      finishedAt: new Date("2026-11-02T10:00:01.000Z"),
      error: "Linear API HTTP 503",
      linear: { requests: 3, complexity: 600 },
    });
    expect(await run(["scheduler"], t.io)).toBe(1);
    expect(t.out).toEqual([]);
    expect(JSON.parse(t.err[0] ?? "")).toMatchObject({
      event: "scheduler",
      outcome: "failed",
      source: "reconcile",
      error: "Linear API HTTP 503",
    });
  });

  it("MIRROR-R13 scheduler exits 1 when the pass cannot start", async () => {
    const t = io();
    t.scheduler.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:1"));
    expect(await run(["scheduler"], t.io)).toBe(1);
    expect(JSON.parse(t.err[0] ?? "")).toEqual({
      event: "scheduler",
      outcome: "failed",
      error: "connect ECONNREFUSED 127.0.0.1:1",
    });
  });

  it("MIRROR-R7 scheduler exits 1 listing what it is missing, before touching anything", async () => {
    const t = io({ DATABASE_URL });
    expect(await run(["scheduler"], t.io)).toBe(1);
    expect(t.scheduler).not.toHaveBeenCalled();
    const message = t.err.join("\n");
    expect(message).toMatch(/LINEAR_CLIENT_ID: is required/);
    expect(message).toMatch(/TOKEN_ENCRYPTION_KEY: is required/);
  });

  it("MIRROR-R5 migrate applies the pending migrations and exits 0 naming them", async () => {
    const t = io();
    t.migrate.mockResolvedValueOnce({ applied: ["0001_init", "0002_mirror"] });
    expect(await run(["migrate"], t.io)).toBe(0);
    expect(t.migrate).toHaveBeenCalledWith(expect.objectContaining({ DATABASE_URL }));
    expect(t.serve).not.toHaveBeenCalled();
    expect(t.out.join("\n")).toMatch(/applied 2 migrations: 0001_init, 0002_mirror/);
  });

  it("MIRROR-R5 migrate exits 0 when the database is already up to date", async () => {
    const t = io();
    expect(await run(["migrate"], t.io)).toBe(0);
    expect(t.out.join("\n")).toMatch(/up to date/);
  });

  it("MIRROR-R5 migrate exits 1 with the error when a migration fails", async () => {
    const t = io();
    t.migrate.mockRejectedValueOnce(new Error("migration 0002_mirror failed: syntax error"));
    expect(await run(["migrate"], t.io)).toBe(1);
    expect(t.err.join("\n")).toMatch(/migrate failed: migration 0002_mirror failed: syntax error/);
  });

  it.each([[{}], [{ DATABASE_URL: "mysql://db/linear" }]])(
    "MIRROR-R5 migrate exits 1 without a valid DATABASE_URL (%j)",
    async (env) => {
      const t = io(env);
      expect(await run(["migrate"], t.io)).toBe(1);
      expect(t.migrate).not.toHaveBeenCalled();
      expect(t.err.join("\n")).toMatch(/DATABASE_URL: /);
    },
  );

  it("SEED-R24 rejects an unknown command with usage", async () => {
    const t = io();
    expect(await run(["deploy"], t.io)).toBe(1);
    expect(t.scheduler).not.toHaveBeenCalled();
    expect(t.err.join("\n")).toMatch(/usage: .*serve.*scheduler.*migrate/i);
  });
});
