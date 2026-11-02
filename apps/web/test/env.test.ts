import { describe, expect, it } from "vitest";
import { commandEnv, parseEnv, parseEnvFor, reservedEnv } from "../src/server/env.ts";

// Harmless values that satisfy every format; none of them is a real credential.
const tokenKey = Buffer.alloc(32, 1).toString("base64");
const complete = {
  DATABASE_URL: "postgres://app:app@localhost:5432/app",
  LINEAR_CLIENT_ID: "test-client-id",
  LINEAR_CLIENT_SECRET: "test-client-secret",
  LINEAR_WEBHOOK_SECRET: "test-webhook-secret",
  SESSION_SECRET: "s".repeat(32),
  TOKEN_ENCRYPTION_KEY: tokenKey,
};
const defaults = { PORT: 3000, PUBLIC_URL: "http://localhost:3000" };

describe("environment schema", () => {
  it("SEED-R22 defaults PORT to 3000 and PUBLIC_URL to http://localhost:3000", () => {
    expect(parseEnv(complete)).toEqual({ ok: true, env: { ...defaults, ...complete } });
  });

  it("SEED-R22 accepts valid values", () => {
    const result = parseEnv({ ...complete, PORT: "8080", PUBLIC_URL: "https://linear.sesv.co" });
    expect(result).toEqual({
      ok: true,
      env: { ...complete, PORT: 8080, PUBLIC_URL: "https://linear.sesv.co" },
    });
  });

  it("SEED-R22 lists every invalid variable by name", () => {
    const result = parseEnv({ ...complete, PORT: "eighty", PUBLIC_URL: "linear.sesv.co" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/^PORT: /);
    expect(result.errors[1]).toMatch(/^PUBLIC_URL: /);
  });

  it.each([["0"], ["65536"], ["3000.5"], [""], [" 3000"]])("SEED-R22 rejects PORT=%j", (port) => {
    const result = parseEnv({ ...complete, PORT: port });
    expect(result.ok).toBe(false);
  });

  it.each([["ftp://linear.sesv.co"], [""], ["https://linear.sesv.co/path"]])(
    "SEED-R22 rejects PUBLIC_URL=%j",
    (url) => {
      const result = parseEnv({ ...complete, PUBLIC_URL: url });
      expect(result.ok).toBe(false);
    },
  );

  it("SEED-R22 declares reserved names as optional and passes them through", () => {
    expect(reservedEnv).toEqual(["ELECTRIC_URL", "ELECTRIC_SECRET"]);
    expect(parseEnv(complete).ok).toBe(true);
    const result = parseEnv({ ...complete, ELECTRIC_URL: "anything" });
    expect(result).toMatchObject({ ok: true, env: { ELECTRIC_URL: "anything" } });
  });

  it("SEED-R22 ignores names outside the contract", () => {
    expect(parseEnv({ ...complete, HOME: "/root", PATH: "/bin" })).toEqual({
      ok: true,
      env: { ...defaults, ...complete },
    });
  });
});

describe("environment per command", () => {
  it("MIRROR-R7 serve requires the database, the OAuth app, the webhook, session and token secrets", () => {
    expect(commandEnv.serve).toEqual([
      "PORT",
      "PUBLIC_URL",
      "DATABASE_URL",
      "LINEAR_CLIENT_ID",
      "LINEAR_CLIENT_SECRET",
      "LINEAR_WEBHOOK_SECRET",
      "SESSION_SECRET",
      "TOKEN_ENCRYPTION_KEY",
      "SIGNIN_ALLOWLIST",
    ]);
    const result = parseEnvFor("serve", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      "DATABASE_URL: is required",
      "LINEAR_CLIENT_ID: is required",
      "LINEAR_CLIENT_SECRET: is required",
      "LINEAR_WEBHOOK_SECRET: is required",
      "SESSION_SECRET: is required",
      "TOKEN_ENCRYPTION_KEY: is required",
    ]);
  });

  it("MIRROR-R7 migrate requires only the database", () => {
    expect(parseEnvFor("migrate", {})).toEqual({
      ok: false,
      errors: ["DATABASE_URL: is required"],
    });
    expect(parseEnvFor("migrate", { DATABASE_URL: complete.DATABASE_URL })).toEqual({
      ok: true,
      env: { DATABASE_URL: complete.DATABASE_URL },
    });
  });

  it("MIRROR-R7 scheduler requires the database and the OAuth client credentials", () => {
    expect(parseEnvFor("scheduler", {})).toEqual({
      ok: false,
      errors: [
        "DATABASE_URL: is required",
        "LINEAR_CLIENT_ID: is required",
        "LINEAR_CLIENT_SECRET: is required",
      ],
    });
    const source = {
      DATABASE_URL: complete.DATABASE_URL,
      LINEAR_CLIENT_ID: complete.LINEAR_CLIENT_ID,
      LINEAR_CLIENT_SECRET: complete.LINEAR_CLIENT_SECRET,
    };
    expect(parseEnvFor("scheduler", source)).toEqual({ ok: true, env: source });
  });

  it("MIRROR-R7 a command ignores names it does not use, even when they are invalid", () => {
    const result = parseEnvFor("migrate", {
      DATABASE_URL: complete.DATABASE_URL,
      PORT: "nope",
      TOKEN_ENCRYPTION_KEY: "short",
    });
    expect(result).toEqual({ ok: true, env: { DATABASE_URL: complete.DATABASE_URL } });
  });

  it("MIRROR-R7 treats an empty value of a required name as missing", () => {
    const result = parseEnvFor("migrate", { DATABASE_URL: "" });
    expect(result).toEqual({ ok: false, errors: ["DATABASE_URL: is required"] });
  });

  it.each([
    ["mysql://app@localhost/app"],
    ["postgres://"],
    ["localhost:5432/app"],
    ["not a url"],
  ])("MIRROR-R7 rejects DATABASE_URL=%j", (url) => {
    const result = parseEnvFor("migrate", { DATABASE_URL: url });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([expect.stringMatching(/^DATABASE_URL: must be a postgres/)]);
  });

  it("MIRROR-R7 accepts postgresql:// as well as postgres://", () => {
    const url = "postgresql://app:secret@db.internal:5432/app?sslmode=disable";
    expect(parseEnvFor("migrate", { DATABASE_URL: url })).toEqual({
      ok: true,
      env: { DATABASE_URL: url },
    });
  });

  it.each([
    ["too short", Buffer.alloc(16, 1).toString("base64")],
    ["too long", Buffer.alloc(48, 1).toString("base64")],
    ["not base64", "!".repeat(44)],
    ["base64url", Buffer.alloc(32, 0xfb).toString("base64url")],
  ])("MIRROR-R7 rejects a TOKEN_ENCRYPTION_KEY that is %s", (_, key) => {
    const result = parseEnvFor("serve", { ...complete, TOKEN_ENCRYPTION_KEY: key });
    expect(result).toEqual({
      ok: false,
      errors: ["TOKEN_ENCRYPTION_KEY: must be 32 bytes encoded as standard base64 (44 characters)"],
    });
  });

  it("MIRROR-R7 rejects a SESSION_SECRET shorter than 32 characters", () => {
    const result = parseEnvFor("serve", { ...complete, SESSION_SECRET: "s".repeat(31) });
    expect(result).toEqual({
      ok: false,
      errors: ["SESSION_SECRET: must be at least 32 characters"],
    });
  });

  it.each([["LINEAR_CLIENT_ID"], ["LINEAR_CLIENT_SECRET"], ["LINEAR_WEBHOOK_SECRET"]])(
    "MIRROR-R7 rejects %s with whitespace",
    (name) => {
      const result = parseEnvFor("serve", { ...complete, [name]: "abc def" });
      expect(result).toEqual({ ok: false, errors: [`${name}: must not contain whitespace`] });
    },
  );

  it("MIRROR-R7 parses SIGNIN_ALLOWLIST as comma-separated emails, trimmed and lowercased", () => {
    const result = parseEnvFor("serve", {
      ...complete,
      SIGNIN_ALLOWLIST: " Ada@Example.com, bob@example.com ,,",
    });
    expect(result).toMatchObject({
      ok: true,
      env: { SIGNIN_ALLOWLIST: ["ada@example.com", "bob@example.com"] },
    });
  });

  it("MIRROR-R7 leaves SIGNIN_ALLOWLIST unset when absent or blank", () => {
    for (const value of [undefined, "", " , "]) {
      const result = parseEnvFor("serve", { ...complete, SIGNIN_ALLOWLIST: value });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.env.SIGNIN_ALLOWLIST).toBeUndefined();
    }
  });

  it("MIRROR-R7 rejects a SIGNIN_ALLOWLIST entry that is not an email", () => {
    const result = parseEnvFor("serve", {
      ...complete,
      SIGNIN_ALLOWLIST: "ada@example.com, bob",
    });
    expect(result).toEqual({
      ok: false,
      errors: ["SIGNIN_ALLOWLIST: must be comma-separated email addresses"],
    });
  });

  it("MIRROR-R7 never echoes a value in an error", () => {
    const secrets = {
      DATABASE_URL: "mysql://user:hunter2-db@localhost/app",
      LINEAR_CLIENT_ID: "id with hunter2-id",
      LINEAR_CLIENT_SECRET: "secret with hunter2-secret",
      LINEAR_WEBHOOK_SECRET: "webhook with hunter2-webhook",
      SESSION_SECRET: "hunter2-session",
      TOKEN_ENCRYPTION_KEY: "hunter2-key",
      SIGNIN_ALLOWLIST: "hunter2-allow",
    };
    const result = parseEnvFor("serve", secrets);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(7);
    expect(result.errors.join("\n")).not.toMatch(/hunter2/);
  });
});
