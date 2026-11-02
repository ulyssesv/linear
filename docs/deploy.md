# Deploy

Hand-off to the infra repository (SEED-R28). This repository builds and publishes one
container image; infra owns the Helm chart, the Argo Application, ingress, DNS and
secret values, and rolls out a release by pinning the image digest (REC-002).

## Image

Published by `.github/workflows/release.yml` for every `v*` release, `linux/amd64` only:

```
ghcr.io/ulyssesv/linear:<tag>@sha256:<digest>    pin this
ghcr.io/ulyssesv/linear:sha-<short commit>       same image, by commit
```

`<tag>` is `v<semver>`, for example `v0.1.0`. The release notes and the job summary of
each release carry the full `<tag>@sha256:...` reference. The package is public, so no
pull secret is needed.

A release is two commits: merging the release-please pull request here tags `v*` and
publishes the image; a values bump in infra pins the new reference and Argo rolls it
out. The image carries no secrets and no environment-specific configuration.

## Process

| | |
|---|---|
| Port | `3000` (HTTP, plain; TLS ends at the proxy) |
| Entrypoint | `node dist/cli.mjs <command>` in `/app` |
| `serve` | Default command. Starts the web server |
| `migrate` | Applies the pending schema migrations and exits 0, or non-zero on any failure. Run it as a Job before each rollout (see [Database](#database)) |
| `scheduler` | Runs one sync pass of the workspace mirror and exits 0, or non-zero on any failure. Run it as a CronJob (see [Scheduler](#scheduler)) |
| Shutdown | Graceful on `SIGTERM` |
| Logs | stdout and stderr; one start line with version, commit and `PUBLIC_URL`; one JSON line per webhook delivery (`{"event":"linear-webhook",...}`) and per `scheduler` pass (`{"event":"scheduler",...}`), see [Reading the logs](#reading-the-logs); one JSON line per sign-in (`{"event":"auth.sign_in","outcome":"accepted\|refused\|failed",...}`) and sign-out, naming the Linear user id, never a token, code or email |

## Probes

Both answer on the app port, with `cache-control: no-store`.

| Probe | Path | Healthy | Unhealthy |
|---|---|---|---|
| Liveness | `/healthz` | 200 `{"status":"ok","version":"0.1.0","commit":"<sha>"}` | no answer |
| Readiness | `/readyz` | 200 `{"status":"ok","checks":{"database":{"status":"ok"}}}` | 503 `{"status":"fail","failing":["database"],"checks":{...}}` |

`/healthz` answers whenever the process can serve requests and is also how the smoke
workflow checks the deployed commit. `/readyz` runs every registered readiness check
with a timeout; each entry in `checks` is `{"status":"ok"}` or
`{"status":"fail","error":"..."}`. The `database` check runs `select 1` against
`DATABASE_URL`, so a pod is not ready while Postgres is unreachable. The liveness probe
does not touch the database: a database outage takes pods out of the Service, it does
not restart them.

## Environment

Each command validates the names it uses at startup and exits non-zero listing every
missing or invalid one by name, never printing a value (MIRROR-R7). The list lives in
`apps/web/src/server/env.ts`. New names arrive with the spec that uses them and are added
here in the same pull request.

| Name | Commands | Default | Format and meaning |
|---|---|---|---|
| `PORT` | `serve` | `3000` | Listen port, integer 1 to 65535 |
| `PUBLIC_URL` | `serve` | `http://localhost:3000` | External origin, `http` or `https`, no path. Set to `https://linear.sesv.co`. Every absolute URL given to Linear derives from it, never from request headers |
| `DATABASE_URL` | `serve`, `migrate`, `scheduler` | required | Postgres, `postgres://` or `postgresql://` URL with user, password, host, port and database; direct and unpooled (see [Database](#database)) |
| `LINEAR_CLIENT_ID` | `serve`, `scheduler` | required | Client id of the Linear OAuth app; no whitespace |
| `LINEAR_CLIENT_SECRET` | `serve`, `scheduler` | required | Client secret of the Linear OAuth app; no whitespace. Rotating it revokes every app token; the server renews on the next call |
| `LINEAR_WEBHOOK_SECRET` | `serve` | required | Signing secret of the OAuth app's webhook; no whitespace |
| `SESSION_SECRET` | `serve` | required | Signs session cookies; at least 32 characters, e.g. `openssl rand -base64 32` |
| `TOKEN_ENCRYPTION_KEY` | `serve`, `scheduler` | required | AES-256 key for Linear tokens at rest, the per-user tokens and the app token: exactly 32 bytes in standard base64 (44 characters), from `openssl rand -base64 32`. Both commands need the same value. Changing it makes stored tokens unreadable, so users sign in again and the next pass requests a new app token |
| `SIGNIN_ALLOWLIST` | `serve` | unset | Optional. Comma-separated emails allowed to sign in, compared case-insensitively; blanks are ignored. Unset or blank lets every member of the workspace sign in |
| `LINEAR_API_URL` | `scheduler` | unset | Not for production: leave it unset. An origin that replaces `https://api.linear.app` for the token and GraphQL endpoints, so tests and the container smoke run a pass against a stub without credentials |

All required names except `PORT` and `PUBLIC_URL` are secrets. Infra holds them as sops
secrets and injects them as environment variables; nothing else holds them, and the image
carries none. The `serve` Deployment needs all of them; the `migrate` Job only
`DATABASE_URL`; the `scheduler` CronJob `DATABASE_URL`, `LINEAR_CLIENT_ID`,
`LINEAR_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY`. The first release with these names will not start `serve` until
the secrets exist, so create them before pinning it.

Reserved: accepted and passed through unvalidated, unused until the spec that needs them
gives them a schema. Infra need not set them yet.

| Name | Planned use |
|---|---|
| `ELECTRIC_URL` | In-cluster Electric service (planning sheet P3) |
| `ELECTRIC_SECRET` | Shared with Electric; the app attaches it, clients never see it |

## Linear OAuth app

One Linear OAuth app in the workspace is the server's only Linear credential (REC-005). It
is created and configured by hand in Linear (Settings, API, OAuth applications) and must
match what the server sends:

| Setting | Value |
|---|---|
| Callback URL (redirect URI) | `https://linear.sesv.co/auth/linear/callback`, that is `${PUBLIC_URL}/auth/linear/callback` |
| Webhook URL | `https://linear.sesv.co/webhooks/linear`, that is `${PUBLIC_URL}/webhooks/linear` |
| Webhook categories | Project, Project update, Initiative, Initiative update |
| Client credentials | Enabled; the server requests a token with scopes `read,write,initiative:read` |
| Scopes | `read` and `write` (`write` is unused until planning sheet P2); sign-in asks users for these two |

Linear serves initiatives and initiative labels to the app actor only with
`initiative:read`, which its OAuth scope list does not mention; with `read` alone the
scheduler's bootstrap fails with HTTP 400 "Invalid scope". Changing the scopes the server
requests revokes the app's existing tokens; the server stores its token under the scope set
it was requested with, so the first run after such a change requests a new one.

The paths are fixed in `apps/web/src/server/linear/urls.ts`. Both must reach the pod
through the ingress, the webhook path from Linear's servers on the public internet.

Local development uses a separate OAuth app, never this one: callback
`http://localhost:3000/auth/linear/callback`, client credentials enabled, webhooks off,
and its own secrets in a `.env` that never leaves the machine. README.md, "Local
environment", has the steps and `.env.example` the names. A webhook would need a public
tunnel, whose origin then becomes `PUBLIC_URL`; without one, `scheduler` runs keep the
local mirror current.

### Webhook endpoint

`POST /webhooks/linear` keeps the mirror current within seconds (MIRROR-R11). What the
ingress and the cluster must allow for it:

| | |
|---|---|
| Reachability | From Linear's servers on the public internet, over HTTPS, `POST` only. No authentication at the ingress: the server checks Linear's signature itself. Bodies are a few kilobytes; the server refuses more than 1 MiB |
| Response budget | Linear counts a delivery as failed when the answer takes more than 5 seconds or is not 200, and retries it after 1 minute, 1 hour and 6 hours; it may disable a webhook that keeps failing. The server answers within 4 seconds, so proxy timeouts must be longer than that and nothing in front of the pod may buffer or queue the request for long |
| Clock | Deliveries whose signed timestamp is more than 60 seconds away from the pod's clock are refused as replays, so nodes must keep time with NTP |
| Answers | 200 applied, ignored, out of scope or already seen; 401 unsigned, mis-signed or stale; 400 malformed; 413 too large; 500 database failure or timeout, which Linear retries |

Each delivery is recorded in the `webhook_deliveries` table by its `Linear-Delivery` id in
the same transaction as its mirror writes, so a retry or a replay is applied once. The
`scheduler` prunes delivery ids older than a week after each successful pass. Each
delivery also writes one JSON log line to stdout, `{"event":"linear-webhook",...}`, with
the delivery id, type, action, entity id, outcome, status, counts and duration; never the
body, the headers or the secret. A run of `unauthorized` lines means
`LINEAR_WEBHOOK_SECRET` does not match the app's signing secret; `stale` lines mean clock
skew.

The server talks to `https://api.linear.app` (token, revoke and GraphQL endpoints) over
HTTPS, so egress must allow it. Calls back off on Linear's rate limits. Measured on the
fixture workspace (about 330 projects) on 2026-11-02: a bootstrap costs 14 requests and
about 11,000 complexity points of the hourly 5,000 requests and 2,000,000 points; a
reconcile pass 10 requests and about 6,000 points, so a pass every 10 minutes uses about
1% of either budget.

## Sign-in and sessions

Sign in with Linear is the only login (MIRROR-R15 to R17, REC-005). Every path is served
by the pod on the app port and must pass through the ingress unchanged, cookies included,
and must not be cached by the proxy (the server sends `cache-control: no-store`).

| Path | Method | Public | What |
|---|---|---|---|
| `/sign-in` | GET | yes | Sign-in page with the "Sign in with Linear" button and refusal messages |
| `/auth/linear/sign-in` | GET | yes | Redirects to Linear's authorize page, user actor, with `state` and PKCE (S256) |
| `/auth/linear/callback` | GET | yes | OAuth redirect URI (see [Linear OAuth app](#linear-oauth-app)); creates the session |
| `/auth/sign-out` | POST | yes | Ends the session and clears the cookie; cross-origin requests get 403 |
| `/sheets` and below | GET | no | Redirect to `/sign-in` without a session |
| `/_serverFn/*` | GET | no | Sheet data and the freshness poll (below); each checks the session itself |

An open sheet asks the server whether the mirror changed every 3 seconds while its tab
is visible (MIRROR-R24): one small GET to `/_serverFn/*` per open sheet, answered from
three index lookups, with the changed rows only when something changed. A hidden tab
stops asking. Nothing to configure, but the proxy must not cache or buffer these
responses (they carry `cache-control: no-store`), and its idle and request timeouts only
need to exceed a normal request: there is no long-lived connection. Polling while a tab
is visible counts as activity for the session's idle timeout.

`/`, `/healthz` and `/readyz` stay public and never read the session store. A request
without a session cookie does not touch the database for auth at all.

A sign-in is accepted when the Linear user belongs to the workspace the OAuth app is
installed in (learned from the app's own token), is not a guest, and, when
`SIGNIN_ALLOWLIST` is set, has an email on it. Anyone else is sent back to `/sign-in`
with a message; no session is created, nothing is stored, and the tokens Linear issued
for the attempt are revoked.

Cookies, both `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` with the `__Host-`
prefix when `PUBLIC_URL` is https (bare names on plain-http development origins):

| Cookie | Lifetime | Holds |
|---|---|---|
| `__Host-linear_session` | `Max-Age` 30 days | A random 256-bit session id. The database stores only its HMAC-SHA256 under `SESSION_SECRET` |
| `__Host-linear_oauth` | 10 minutes, cleared by the callback | The signed sign-in attempt: `state`, PKCE verifier, return path |

Sessions live in Postgres (`auth_sessions`). One ends after 7 days without a request
(sliding; activity is recorded at most once an hour), 30 days after sign-in whatever
the activity, or on sign-out. Expired rows are purged on each sign-in. Rotating
`SESSION_SECRET` signs everyone out at once.

Per-user Linear access and refresh tokens are stored in `auth_linear_tokens`, encrypted
with AES-256-GCM under `TOKEN_ENCRYPTION_KEY` (a random IV per value, bound to the user
and column, format `v1:<iv>:<ciphertext>:<tag>`), refreshed server-side shortly before
the access token's 24-hour expiry, and never sent to the browser or logged. Losing or
changing the key makes them unreadable; users then sign in again. They are unused until
planning sheet P2.

## Database

The site needs one PostgreSQL database (MIRROR, planning sheet P1).

| | |
|---|---|
| Version | PostgreSQL 18. CI and local development run `postgres:18.6`, pinned in `compose.yaml` |
| Logical replication | On from the start: `wal_level = logical`. Unused until Electric arrives in P3, which then needs a role with `REPLICATION` and a few replication slots; setting it now avoids a restart and a database change later |
| Connection | Direct to Postgres, not through PgBouncer or another transaction pooler: logical replication and session features need a real session. The server keeps a pool of at most 10 connections per replica; `migrate` uses one, `scheduler` up to three and holds a session-level advisory lock for its pass |
| Role | Owns the database, or may create tables, indexes and types in its `public` schema. No superuser needed |
| TLS | Add `sslmode` and friends to the URL as query parameters if the server requires them |

### Migrations

The image carries its migrations. `node dist/cli.mjs migrate` applies the pending ones
in order, each in its own transaction, records them in the `schema_migrations` table,
and exits 0; it exits non-zero, with the error on stderr, when the database cannot be
reached or a migration fails, which leaves that migration fully rolled back. Running it
again applies nothing new and exits 0. Concurrent runs wait on a Postgres advisory lock,
so two Jobs at once are safe.

Run it before each rollout as a Job with the same image reference, the same
`DATABASE_URL` and the same security context as the Deployment, for example an Argo CD
`PreSync` hook, and let a failed Job stop the sync:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  generateName: linear-migrate-
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: BeforeHookCreation
spec:
  backoffLimit: 1
  activeDeadlineSeconds: 300
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: ghcr.io/ulyssesv/linear:<tag>@sha256:<digest>
          args: ["migrate"]
          env:
            - name: DATABASE_URL
              valueFrom: { secretKeyRef: { name: linear, key: DATABASE_URL } }
          # securityContext, the /tmp volume and its mount as in "Security context" below
          resources:
            requests: { cpu: 10m, memory: 96Mi }
            limits: { memory: 192Mi }
```

Migrations are written so the previous release still runs against the new schema
(expand first, contract in a later release): pods of the old release keep serving while
the Job runs and until the rollout replaces them.

## Scheduler

`node dist/cli.mjs scheduler` runs one sync pass of the workspace mirror (MIRROR-R13) and
exits: 0 when the pass succeeded, or when another pass was already running; 1 when the
environment is invalid, the database cannot be reached, or the pass failed. A failed pass
changes nothing in the mirror and is retried in full by the next run, so the CronJob's
history shows the truth and nothing is lost by failing.

A pass:

- Bootstraps when the mirror is empty, the first run after the first rollout included:
  it lists every entity type in full. For the fixture workspace that is about 14
  requests and takes seconds.
- Otherwise reconciles: lists the reference data (teams, users, statuses, labels) in
  full, projects and initiatives changed since the start of the last successful pass
  minus 15 minutes, and the ids of every project and initiative to flag the deleted or
  trashed ones removed. Staleness is therefore bounded by the schedule, whatever happens
  to webhooks.
- Takes a Postgres advisory lock first. A run that finds it taken logs
  `"outcome":"skipped","reason":"another pass is running"` and exits 0 without touching
  Linear. `concurrencyPolicy: Forbid` makes that rare; the lock makes it safe.
- Reuses the OAuth app's token, stored encrypted in the database with
  `TOKEN_ENCRYPTION_KEY`; it requests a new one only when the stored one is missing,
  close to its 30-day expiry, or rejected. Linear allows 1000 active app tokens per app,
  so a run must never mint one each time.
- Uses at most 3 database connections and closes them before exiting.

Each run leaves one JSON line: on stdout when it succeeded or skipped, on stderr when it
failed. For example:

```json
{"event":"scheduler","outcome":"ok","source":"reconcile","startedAt":"2026-11-02T10:00:00.000Z","finishedAt":"2026-11-02T10:00:02.512Z","durationMs":2512,"since":"2026-11-02T09:35:00.000Z","changed":3,"counts":{"projects":{"inserted":1,"updated":1,"unchanged":0,"removed":1,"dropped":0},"...":{}},"linear":{"requests":10,"complexity":8345}}
{"event":"scheduler","outcome":"failed","source":"reconcile","startedAt":"...","finishedAt":"...","durationMs":412,"error":"Linear API HTTP 503","linear":{"requests":3,"complexity":600}}
```

`source` is `bootstrap` or `reconcile`; `since` is the start of the window, `null` for a
full listing; `counts` has one entry per entity type. Every pass is also recorded in the
`mirror_sync_log` table with the same outcome and counts.

Suggested CronJob: every 10 minutes (the bound on how stale the mirror can get when
webhooks fail; pick it with the author), same image reference and security context as
the Deployment:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: linear-scheduler
spec:
  schedule: "*/10 * * * *"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 300
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      backoffLimit: 0
      activeDeadlineSeconds: 540
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: scheduler
              image: ghcr.io/ulyssesv/linear:<tag>@sha256:<digest>
              args: ["scheduler"]
              env:
                - name: DATABASE_URL
                  valueFrom: { secretKeyRef: { name: linear, key: DATABASE_URL } }
                - name: LINEAR_CLIENT_ID
                  valueFrom: { secretKeyRef: { name: linear, key: LINEAR_CLIENT_ID } }
                - name: LINEAR_CLIENT_SECRET
                  valueFrom: { secretKeyRef: { name: linear, key: LINEAR_CLIENT_SECRET } }
                - name: TOKEN_ENCRYPTION_KEY
                  valueFrom: { secretKeyRef: { name: linear, key: TOKEN_ENCRYPTION_KEY } }
              # securityContext, the /tmp volume and its mount as in "Security context" below
              resources:
                requests: { cpu: 20m, memory: 128Mi }
                limits: { memory: 256Mi }
```

`backoffLimit: 0` because the next scheduled run is the retry; `activeDeadlineSeconds`
keeps a run that waits on Linear's rate limit from overlapping the next one by much. The
`migrate` Job must have run first: a pass against a database without the mirror tables
fails. Egress to `https://api.linear.app` is needed, as for `serve`.

## Reading the logs

The mirror has two feeders, and each leaves one JSON line per unit of work with its
outcome and counts (MIRROR-R31): `serve` one `linear-webhook` line per delivery, the
`scheduler` CronJob one `scheduler` line per pass. Neither line carries a body, a header,
a token or a secret.

`linear-webhook` outcomes, with the HTTP status Linear sees:

| `outcome` | Status | Meaning | What to do |
|---|---|---|---|
| `applied` | 200 | Written to the mirror; `counts` says how | Nothing |
| `dropped` | 200 | Belongs only to a private team, so never stored (MIRROR-R12) | Nothing |
| `ignored` | 200 | A type or action the mirror does not follow | Nothing |
| `duplicate` | 200 | A delivery id already applied: Linear's retry or a replay | Nothing |
| `unauthorized` | 401 | The signature does not match | `LINEAR_WEBHOOK_SECRET` differs from the app's signing secret |
| `stale` | 401 | Signed more than 60 seconds away from the pod's clock | Node clock skew; check NTP |
| `invalid`, `too-large` | 400, 405, 413 | Not a webhook delivery Linear would send | Nothing, unless they come from Linear |
| `misconfigured` | 500 | No signing secret, or the database client could not start | The `error` field says which |
| `timeout`, `failed` | 500 | The database did not finish in time, or failed; nothing was written | The database; Linear retries after 1 minute, 1 hour and 6 hours |

`scheduler` outcomes: `ok` with `source`, `changed`, per-type `counts` and the Linear
cost; `skipped` when another pass held the lock; `failed`, on stderr and exit 1, with the
`error`. Each pass, and each delivery that reaches the database, also leaves a row with
the same outcome and counts in the `mirror_sync_log` table.

Why the mirror is stale, from the logs alone:

- No `linear-webhook` lines at all after changes in Linear: the webhook is disabled or
  missing in the OAuth app, or the ingress does not route `POST /webhooks/linear`. Linear
  disables a webhook that keeps failing.
- `unauthorized`, `stale`, `timeout` or `failed` lines: the table above.
- `applied` lines but the sheet does not show the change: the row is out of scope
  (`dropped` in `counts`), or the change was to a field the sheet does not show.
- No `scheduler` lines, or only `failed` ones: the CronJob is suspended, cannot pull the
  image, or each pass fails for the reason in `error`. Until a pass succeeds, the mirror
  is only as fresh as the webhooks keep it.
- `scheduler` lines with `"outcome":"ok"` and `"changed":0` while Linear shows a change
  older than the window: the change is to an entity of a private team, or to a type the
  mirror does not hold.

## Security context

The image runs as uid and gid 10001, owns nothing under `/app`, and writes only to
`/tmp`. It works under the Pod Security Standards baseline with:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: [ALL]
  seccompProfile:
    type: RuntimeDefault
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir: {}
```

CI and the release workflow run every image with the equivalent Docker flags
(`--user 10001 --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs
/tmp`) through `tools/container-smoke.sh` before it is published, against a throwaway
Postgres: `migrate` twice, `serve` with `/healthz` and `/readyz`, and `scheduler` twice,
bootstrap then reconcile, against a stub of Linear's API (`tools/linear-stub.mjs`, run
with the image's own Node) through `LINEAR_API_URL`, so the smoke needs no credentials.

## Resources

Measured on 2026-11-02 with the built server (Node 26, macOS arm64; Linux resident sizes
are similar) against a mirror of about 330 projects, peak resident memory:

| Process | Peak | Measured while |
|---|---|---|
| `serve` | about 90 MiB | idle after start, the database pool open |
| `serve` | about 180 MiB | one user loading a projects sheet of 630 rows, six times in a row |
| `serve` | about 320 MiB | four users loading sheets of 1,500 rows at once |
| `scheduler` | about 95 MiB | a bootstrap, 434 rows written in 2.4 seconds; a reconcile peaks near 85 MiB |
| `migrate` | about 75 MiB | applying every migration to an empty database |

A sheet's data is built in memory for each request, so memory follows concurrent sheet
loads, not the number of signed-in users. Suggested starting point for one `serve`
replica:

```yaml
resources:
  requests: { cpu: 50m, memory: 256Mi }
  limits: { memory: 512Mi }
```

No CPU limit, to avoid throttling server rendering; CPU stays near zero at idle and a
sheet load costs tens of milliseconds. The `migrate` Job's hints are in
[Migrations](#migrations), the `scheduler` CronJob's in [Scheduler](#scheduler). Revisit
when planning sheet P3 adds Electric.

Database: the mirror of about 330 projects and its reference data take about 2 MiB, the
whole database about 10 MiB; it grows with the workspace, not with traffic. Connections:
up to 10 per `serve` replica, 3 for `scheduler` and 1 for `migrate`, so with one replica
14 at most; keep `max_connections` well above that for Electric in P3.

The server does not compress responses. Please enable compression at the ingress
(Traefik's `compress` middleware, gzip or brotli) for this host. It matters for the
sheets (MIRROR-R25): with three hundred projects the sheet's data is about 300 KiB, or
15 KiB gzipped, and the grid's script about 820 KiB, or 190 KiB gzipped.

## Hostname

Public hostname: `linear.sesv.co`, served over HTTPS by the cluster ingress. The site is
public; `smoke.yml` checks it from GitHub-hosted runners.

`dig +short linear.sesv.co` returned the public address `77.165.7.146` on 2026-11-02, and
`/healthz` answered `0.1.0` from it.

## Verifying a rollout

Run the `smoke` workflow (Actions, smoke, Run workflow) with `base_url`
`https://linear.sesv.co` and `expected_commit` set to the released commit. It runs the
Playwright `smoke` project: landing page, `/healthz`, `/readyz`, and the served commit.
Locally: `BASE_URL=https://linear.sesv.co EXPECTED_COMMIT=<sha> pnpm test:smoke`.

### First rollout of the planning sheet

The first release with the planning sheet (0.2.0) is the first to need a database,
secrets and the Linear OAuth app. In order:

1. **Database.** PostgreSQL 18 with `wal_level = logical` and a role as in
   [Database](#database); its direct URL as the `DATABASE_URL` secret.
2. **Linear OAuth app.** Created in Linear as in [Linear OAuth app](#linear-oauth-app):
   callback and webhook URLs, the four webhook categories, client credentials enabled.
   Its client id, client secret and webhook signing secret become secrets.
3. **Secrets.** Every name in [Environment](#environment): `SESSION_SECRET` and
   `TOKEN_ENCRYPTION_KEY` generated fresh, and `SIGNIN_ALLOWLIST` if sign-in should be
   limited. `serve` will not start without them, so they exist before step 5.
4. **Ingress.** The paths in [Sign-in and sessions](#sign-in-and-sessions) and
   [Webhook endpoint](#webhook-endpoint) reach the pod unchanged, not cached or
   buffered; compression on, as in [Resources](#resources).
5. **Pin the image.** The values bump pins the release's `<tag>@sha256:...`, with the
   `migrate` PreSync Job, the `scheduler` CronJob and the revised resources. Argo runs
   `migrate` (`applied N migrations: ...` in its log), then rolls out `serve`.
6. **First pass.** Run it now rather than waiting for the schedule:
   `kubectl create job --from=cronjob/linear-scheduler linear-scheduler-first`. Its line
   reads `"outcome":"ok","source":"bootstrap"`; the next scheduled ones read `reconcile`.
7. **Smoke.** The `smoke` workflow as above, with the released commit.

Then the author checks the planning sheet end to end (spec MIRROR, T10):

- Sign in at `https://linear.sesv.co` and open the projects sheet.
- Change a project in Linear: within ten seconds the row changes in the open sheet, and
  `serve` logs a `linear-webhook` line with `"outcome":"applied"`.
- Disable the webhook in the OAuth app, change another project, and wait for the next
  scheduled pass: its `scheduler` line has `"changed"` of at least 1, and the row changes
  in the open sheet. Enable the webhook again.
- A project that belongs only to a private team never appears in either sheet.
