// The e2e server runs with fixed values, whatever the developer's shell holds.
import { describe, expect, it } from "vitest";
import { e2eServerEnv } from "../e2e/server-env.ts";
import { parseEnvFor } from "../src/server/env.ts";

describe("e2e server environment", () => {
  it("blanks the optional names, so the shell's values never reach the e2e server", () => {
    const shell = {
      SIGNIN_ALLOWLIST: "someone@example.com",
      LINEAR_API_URL: "http://localhost:9999",
      ELECTRIC_URL: "http://localhost:3001",
    };
    const env = { ...shell, ...e2eServerEnv(3100) };
    const serve = parseEnvFor("serve", env);
    expect(serve.ok && serve.env.SIGNIN_ALLOWLIST).toBeUndefined();
    expect(serve.ok && serve.env.ELECTRIC_URL).toBe("");
    const scheduler = parseEnvFor("scheduler", env);
    expect(scheduler.ok && scheduler.env.LINEAR_API_URL).toBeUndefined();
  });
});
