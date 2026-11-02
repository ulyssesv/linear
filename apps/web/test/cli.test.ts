import { describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.ts";
import type { Env } from "../src/server/env.ts";

// Harmless values that satisfy every format serve requires (MIRROR-R7).
const required = {
  DATABASE_URL: "postgres://app:app@localhost:5432/app",
  LINEAR_CLIENT_ID: "test-client-id",
  LINEAR_CLIENT_SECRET: "test-client-secret",
  LINEAR_WEBHOOK_SECRET: "test-webhook-secret",
  SESSION_SECRET: "s".repeat(32),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

function io(env: Record<string, string | undefined> = required) {
  const out: string[] = [];
  const err: string[] = [];
  const serve = vi.fn(async (_env: Env) => {});
  return {
    io: { env, stdout: (l: string) => out.push(l), stderr: (l: string) => err.push(l), serve },
    out,
    err,
    serve,
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

  it.each([["scheduler"], ["migrate"]])(
    "SEED-R24 %s is reserved: exits 2 naming the spec that will implement it",
    async (command) => {
      const t = io();
      expect(await run([command], t.io)).toBe(2);
      expect(t.serve).not.toHaveBeenCalled();
      expect(t.err.join("\n")).toMatch(new RegExp(`${command}.*planning-sheet spec`));
    },
  );

  it("SEED-R24 rejects an unknown command with usage", async () => {
    const t = io();
    expect(await run(["deploy"], t.io)).toBe(1);
    expect(t.err.join("\n")).toMatch(/usage: .*serve.*scheduler.*migrate/i);
  });
});
