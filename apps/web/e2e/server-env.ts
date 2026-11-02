// What the `local` project's server runs with, shared by playwright.config.ts and the
// helpers that write to the same database (e2e/auth.ts). None of it is a credential.
import { localDatabaseUrl } from "../src/server/db/local.ts";
import { commandEnv, reservedEnv } from "../src/server/env.ts";

export const e2eDatabaseUrl = process.env.DATABASE_URL || localDatabaseUrl;

export const e2eSessionSecret = "e2e-session-secret-at-least-32-characters";

/**
 * Every name the commands read, blank. Playwright lays webServer.env over the shell's
 * environment, and a developer's shell carries the local `.env` through mise; blank counts
 * as unset, so an allowlist or API origin from there never reaches the e2e server.
 */
const blank = Object.fromEntries(
  [...new Set([...Object.values(commandEnv).flat(), ...reservedEnv])].map((name) => [name, ""]),
);

/** The environment of `serve` for the local project (MIRROR-R7). */
export function e2eServerEnv(port: number): Record<string, string> {
  return {
    ...blank,
    PORT: String(port),
    PUBLIC_URL: `http://localhost:${port}`,
    DATABASE_URL: e2eDatabaseUrl,
    LINEAR_CLIENT_ID: "e2e-client-id",
    LINEAR_CLIENT_SECRET: "e2e-client-secret",
    LINEAR_WEBHOOK_SECRET: "e2e-webhook-secret",
    SESSION_SECRET: e2eSessionSecret,
    TOKEN_ENCRYPTION_KEY: "ZTJlLXRva2VuLWVuY3J5cHRpb24ta2V5LTMyLWJ5dGU=",
  };
}
