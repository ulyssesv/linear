-- Sign in with Linear (MIRROR-R16, MIRROR-R17). 0002 is the mirror's (MIRROR T3); the
-- runner applies by version, so either may land first.
--
-- Tables are prefixed auth_ so they never collide with the mirror's copy of Linear users.

-- People who signed in. `id` is their Linear user id.
create table auth_users (
  id text primary key,
  organization_id text not null,
  name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz not null
);

-- Their Linear OAuth tokens, encrypted with AES-256-GCM under TOKEN_ENCRYPTION_KEY
-- (`v1:<iv>:<ciphertext>:<tag>`, bound to the user and column). Never plaintext.
create table auth_linear_tokens (
  user_id text primary key references auth_users (id) on delete cascade,
  access_token text not null,
  refresh_token text,
  access_expires_at timestamptz not null,
  scope text not null,
  updated_at timestamptz not null
);

-- Server-side sessions. The cookie holds a random id; only its HMAC under SESSION_SECRET
-- is stored, so the table alone cannot be turned into cookies.
create table auth_sessions (
  id_hash text primary key,
  user_id text not null references auth_users (id) on delete cascade,
  created_at timestamptz not null,
  last_seen_at timestamptz not null
);

create index auth_sessions_user_id on auth_sessions (user_id);
create index auth_sessions_last_seen_at on auth_sessions (last_seen_at);
