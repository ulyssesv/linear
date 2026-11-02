// Harmless values for every name serve requires (MIRROR-R7). They satisfy each format and
// none of them is a credential.
export const serveEnv = {
  DATABASE_URL: "postgres://app:app@localhost:5432/app",
  LINEAR_CLIENT_ID: "test-client-id",
  LINEAR_CLIENT_SECRET: "test-client-secret",
  LINEAR_WEBHOOK_SECRET: "test-webhook-secret",
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};
