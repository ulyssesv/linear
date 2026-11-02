-- The OAuth app's client-credentials token, shared by every process (MIRROR-R2, MIRROR-R13).
--
-- Linear allows 1000 active app tokens per app and each lives 30 days, so the scheduler
-- CronJob, a new process every few minutes, must reuse one token rather than mint one per
-- run. One row per OAuth client id: a new app (another client id) starts without a token.
-- The token is encrypted with TOKEN_ENCRYPTION_KEY (src/server/auth/token-cipher.ts),
-- bound to its client id; src/server/linear/app-token-store.ts reads and writes it.

create table linear_app_token (
  client_id text primary key,
  -- `v1:<iv>:<ciphertext>:<tag>`, never the plain token.
  access_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
