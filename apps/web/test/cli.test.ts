import { describe, expect, it, vi } from "vitest";
import { type MigrateCommand, run } from "../src/cli.ts";
import type { Env } from "../src/server/env.ts";
import { serveEnv as required } from "./serve-env.ts";

const DATABASE_URL = required.DATABASE_URL;

function io(env: Record<string, string | undefined> = required) {
  const out: string[] = [];
  const err: string[] = [];
  const serve = vi.fn(async (_env: Env) => {});
  const migrate = vi.fn<MigrateCommand>(async () => ({ applied: [] }));
  return {
    io: {
      env,
      stdout: (l: string) => out.push(l),
      stderr: (l: string) => err.push(l),
      serve,
      migrate,
    },
    out,
    err,
    serve,
    migrate,
  };
}

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

  it("SEED-R24 scheduler is reserved: exits 2 naming the spec that will implement it", async () => {
    const t = io();
    expect(await run(["scheduler"], t.io)).toBe(2);
    expect(t.serve).not.toHaveBeenCalled();
    expect(t.migrate).not.toHaveBeenCalled();
    expect(t.err.join("\n")).toMatch(/scheduler.*planning-sheet spec/);
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
    expect(t.err.join("\n")).toMatch(/usage: .*serve.*scheduler.*migrate/i);
  });
});
