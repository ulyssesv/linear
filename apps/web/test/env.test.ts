import { describe, expect, it } from "vitest";
import { parseEnv, reservedEnv } from "../src/server/env.ts";

describe("environment schema", () => {
  it("SEED-R22 defaults PORT to 3000 and PUBLIC_URL to http://localhost:3000", () => {
    expect(parseEnv({})).toEqual({
      ok: true,
      env: { PORT: 3000, PUBLIC_URL: "http://localhost:3000" },
    });
  });

  it("SEED-R22 accepts valid values", () => {
    const result = parseEnv({ PORT: "8080", PUBLIC_URL: "https://linear.sesv.co" });
    expect(result).toEqual({
      ok: true,
      env: { PORT: 8080, PUBLIC_URL: "https://linear.sesv.co" },
    });
  });

  it("SEED-R22 lists every invalid variable by name", () => {
    const result = parseEnv({ PORT: "eighty", PUBLIC_URL: "linear.sesv.co" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/^PORT: /);
    expect(result.errors[1]).toMatch(/^PUBLIC_URL: /);
  });

  it.each([["0"], ["65536"], ["3000.5"], [""], [" 3000"]])("SEED-R22 rejects PORT=%j", (port) => {
    const result = parseEnv({ PORT: port });
    expect(result.ok).toBe(false);
  });

  it.each([["ftp://linear.sesv.co"], [""], ["https://linear.sesv.co/path"]])(
    "SEED-R22 rejects PUBLIC_URL=%j",
    (url) => {
      const result = parseEnv({ PUBLIC_URL: url });
      expect(result.ok).toBe(false);
    },
  );

  it("SEED-R22 declares reserved names as optional and passes them through", () => {
    expect(reservedEnv.length).toBeGreaterThan(0);
    expect(parseEnv({}).ok).toBe(true);
    const name = reservedEnv[0] as string;
    const result = parseEnv({ [name]: "anything" });
    expect(result).toMatchObject({ ok: true, env: { [name]: "anything" } });
  });

  it("MIRROR-R5 MIRROR-R6 accepts a postgres or postgresql DATABASE_URL", () => {
    for (const url of [
      "postgres://linear:secret@db.internal:5432/linear",
      "postgresql://linear@localhost/linear?sslmode=disable",
    ]) {
      expect(parseEnv({ DATABASE_URL: url })).toMatchObject({
        ok: true,
        env: { DATABASE_URL: url },
      });
    }
  });

  it.each([["mysql://db/linear"], ["postgres:///linear"], ["not a url"], [""]])(
    "MIRROR-R5 rejects DATABASE_URL=%j without echoing its value",
    (url) => {
      const result = parseEnv({ DATABASE_URL: url });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toEqual([expect.stringMatching(/^DATABASE_URL: /)]);
      if (url) expect(result.errors[0]).not.toContain(url);
    },
  );

  it("MIRROR-R5 MIRROR-R6 DATABASE_URL is optional unless the caller requires it", () => {
    expect(parseEnv({}).ok).toBe(true);
    expect(parseEnv({}, ["DATABASE_URL"])).toEqual({
      ok: false,
      errors: ["DATABASE_URL: is required"],
    });
  });

  it("MIRROR-R5 DATABASE_URL is validated, no longer reserved", () => {
    expect(reservedEnv).not.toContain("DATABASE_URL");
  });

  it("SEED-R22 ignores names outside the contract", () => {
    expect(parseEnv({ HOME: "/root", PATH: "/bin" })).toEqual({
      ok: true,
      env: { PORT: 3000, PUBLIC_URL: "http://localhost:3000" },
    });
  });
});
