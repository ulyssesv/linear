// End-to-end tests (SEED-R17, SEED-R20, SEED-R27). Two projects run the same site checks:
// `local` against the built server started here, `smoke` against a deployed BASE_URL.
// `local` also runs the database checks against the compose or CI database (MIRROR-R8).
import { defineConfig, devices } from "@playwright/test";
import { localDatabaseUrl } from "./src/server/db/local.ts";

// E2E_PORT moves the local server off 3100, e.g. when another checkout already serves there.
const port = Number(process.env.E2E_PORT) || 3100;
const remote = process.env.BASE_URL || undefined;
const databaseUrl = process.env.DATABASE_URL || localDatabaseUrl;

if (process.env.npm_lifecycle_event === "test:smoke" && !remote) {
  throw new Error(
    "BASE_URL is required for the smoke project, e.g. BASE_URL=https://linear.sesv.co",
  );
}

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  projects: [
    {
      name: "local",
      testMatch: ["site.spec.ts", "database.spec.ts"],
      use: { baseURL: `http://localhost:${port}` },
    },
    {
      name: "smoke",
      testMatch: ["site.spec.ts", "smoke.spec.ts"],
      use: { baseURL: remote },
    },
  ],
  // The local project needs `pnpm build` first; it serves dist/ and never builds. It
  // migrates first, as the Job before each rollout does (docs/deploy.md).
  webServer: remote
    ? undefined
    : {
        command: "node dist/cli.mjs migrate && node dist/cli.mjs serve",
        url: `http://localhost:${port}/healthz`,
        // The real database, plus harmless values for the other names serve requires
        // (MIRROR-R7); none is a credential.
        env: {
          PORT: String(port),
          PUBLIC_URL: `http://localhost:${port}`,
          DATABASE_URL: databaseUrl,
          LINEAR_CLIENT_ID: "e2e-client-id",
          LINEAR_CLIENT_SECRET: "e2e-client-secret",
          LINEAR_WEBHOOK_SECRET: "e2e-webhook-secret",
          SESSION_SECRET: "e2e-session-secret-at-least-32-characters",
          TOKEN_ENCRYPTION_KEY: "ZTJlLXRva2VuLWVuY3J5cHRpb24ta2V5LTMyLWJ5dGU=",
        },
        // Never reuse: a server left on the port from another checkout would be tested in
        // place of this build. A busy port fails the run; E2E_PORT moves it.
        reuseExistingServer: false,
        stdout: "pipe",
        timeout: 30_000,
      },
});
