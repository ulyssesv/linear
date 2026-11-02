// End-to-end tests (SEED-R17, SEED-R20, SEED-R27). Two projects run the same site checks:
// `local` against the built server started here, `smoke` against a deployed BASE_URL.
import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const remote = process.env.BASE_URL || undefined;

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
      testMatch: "site.spec.ts",
      use: { baseURL: `http://localhost:${port}` },
    },
    {
      name: "smoke",
      testMatch: ["site.spec.ts", "smoke.spec.ts"],
      use: { baseURL: remote },
    },
  ],
  // The local project needs `pnpm build` first; it serves dist/ and never builds.
  webServer: remote
    ? undefined
    : {
        command: "node dist/cli.mjs serve",
        url: `http://localhost:${port}/healthz`,
        // Harmless values for the names serve requires (MIRROR-R7); none is a credential.
        env: {
          PORT: String(port),
          PUBLIC_URL: `http://localhost:${port}`,
          DATABASE_URL: "postgres://e2e:e2e@localhost:5432/e2e",
          LINEAR_CLIENT_ID: "e2e-client-id",
          LINEAR_CLIENT_SECRET: "e2e-client-secret",
          LINEAR_WEBHOOK_SECRET: "e2e-webhook-secret",
          SESSION_SECRET: "e2e-session-secret-at-least-32-characters",
          TOKEN_ENCRYPTION_KEY: "ZTJlLXRva2VuLWVuY3J5cHRpb24ta2V5LTMyLWJ5dGU=",
        },
        reuseExistingServer: !process.env.CI,
        stdout: "pipe",
        timeout: 30_000,
      },
});
