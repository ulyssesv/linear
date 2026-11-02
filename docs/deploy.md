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
| Logs | stdout and stderr; one start line with version, commit and `PUBLIC_URL`; one JSON line per `scheduler` pass |

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
| Client credentials | Enabled; the server requests a token with scopes `read,write` |
| Scopes | `read` and `write` (`write` is unused until planning sheet P2) |

The paths are fixed in `apps/web/src/server/linear/urls.ts`. Both must reach the pod
through the ingress, the webhook path from Linear's servers on the public internet. For
local development add `http://localhost:3000/auth/linear/callback` as a second callback
URL; a webhook needs a public tunnel, whose origin then becomes `PUBLIC_URL`.

The server talks to `https://api.linear.app` (token endpoint and GraphQL) over HTTPS, so
egress must allow it. Calls back off on Linear's rate limits; a bootstrap of the fixture
workspace costs about 14 requests and 40,000 complexity points of the hourly 5,000 and
2,000,000; a reconcile pass about 10 requests and 8,000 points.

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
            requests: { cpu: 10m, memory: 64Mi }
            limits: { memory: 128Mi }
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
                requests: { cpu: 20m, memory: 96Mi }
                limits: { memory: 192Mi }
```

`backoffLimit: 0` because the next scheduled run is the retry; `activeDeadlineSeconds`
keeps a run that waits on Linear's rate limit from overlapping the next one by much. The
`migrate` Job must have run first: a pass against a database without the mirror tables
fails. Egress to `https://api.linear.app` is needed, as for `serve`.

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

Measured locally on the seed image: about 40 MiB resident after start and a few
landing-page requests, near-zero CPU at idle. Suggested starting point for one replica:

```yaml
resources:
  requests: { cpu: 50m, memory: 128Mi }
  limits: { memory: 256Mi }
```

No CPU limit, to avoid throttling server rendering. Revisit when the planning sheet adds
mirror and Electric traffic. The `migrate` Job's hints are in [Migrations](#migrations),
the `scheduler` CronJob's in [Scheduler](#scheduler).

## Hostname

Public hostname: `linear.sesv.co`, served over HTTPS by the cluster ingress. The site is
public; `smoke.yml` checks it from GitHub-hosted runners.

`linear.sesv.co` currently resolves to a private address: `dig +short linear.sesv.co`
returned `10.0.10.53` on 2026-11-01. It must be repointed to the public ingress before
the site is reachable from outside and before `smoke.yml` can pass.

## Verifying a rollout

Run the `smoke` workflow (Actions, smoke, Run workflow) with `base_url`
`https://linear.sesv.co` and `expected_commit` set to the released commit. It runs the
Playwright `smoke` project: landing page, `/healthz`, `/readyz`, and the served commit.
Locally: `BASE_URL=https://linear.sesv.co EXPECTED_COMMIT=<sha> pnpm test:smoke`.
