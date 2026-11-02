// What the `local` project's server runs with, shared by playwright.config.ts and the
// helpers that write to the same database (e2e/auth.ts). None of it is a credential.
import { localDatabaseUrl } from "../src/server/db/local.ts";

export const e2eDatabaseUrl = process.env.DATABASE_URL || localDatabaseUrl;

export const e2eSessionSecret = "e2e-session-secret-at-least-32-characters";

/** The environment of `serve` for the local project (MIRROR-R7). */
export function e2eServerEnv(port: number): Record<string, string> {
  return {
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
