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
| `scheduler` | Reserved. Exits with code 2 and a message naming the spec that will implement it, so a CronJob fails loudly until then |
| Shutdown | Graceful on `SIGTERM` |
| Logs | stdout and stderr; one start line with version, commit and `PUBLIC_URL` |

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

The server validates its environment at startup and exits non-zero listing every
missing or invalid variable.

Required, with defaults:

| Name | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Listen port, integer 1 to 65535 |
| `PUBLIC_URL` | `http://localhost:3000` | External origin, `http` or `https`, no path. Set to `https://linear.sesv.co` |

Required, without a default, by the commands named:

| Name | Commands | Meaning |
|---|---|---|
| `DATABASE_URL` | `serve`, `migrate` | `postgres://` or `postgresql://` URL with user, password, host, port and database, direct and unpooled (see [Database](#database)). A secret: it carries the password. Never logged; errors name the variable, not its value |

Reserved: accepted and passed through unvalidated, unused until the spec that needs them
gives them a schema. Infra need not set them yet.

| Name | Planned use |
|---|---|
| `ELECTRIC_URL` | In-cluster Electric service |
| `ELECTRIC_SECRET` | Shared with Electric; the app attaches it, clients never see it |
| `SESSION_SECRET` | Session signing |
| `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` | Linear OAuth app |

The list lives in `apps/web/src/server/env.ts`. New names arrive with the spec that uses
them and are added here in the same pull request.

## Database

The site needs one PostgreSQL database (MIRROR, planning sheet P1).

| | |
|---|---|
| Version | PostgreSQL 18. CI and local development run `postgres:18.6`, pinned in `compose.yaml` |
| Logical replication | On from the start: `wal_level = logical`. Unused until Electric arrives in P3, which then needs a role with `REPLICATION` and a few replication slots; setting it now avoids a restart and a database change later |
| Connection | Direct to Postgres, not through PgBouncer or another transaction pooler: logical replication and session features need a real session. The server keeps a pool of at most 10 connections per replica; `migrate` uses one |
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
Postgres: `migrate` twice, `serve` with `/healthz` and `/readyz`, and `scheduler`.

## Resources

Measured locally on the seed image: about 40 MiB resident after start and a few
landing-page requests, near-zero CPU at idle. Suggested starting point for one replica:

```yaml
resources:
  requests: { cpu: 50m, memory: 128Mi }
  limits: { memory: 256Mi }
```

No CPU limit, to avoid throttling server rendering. Revisit when the planning sheet adds
mirror and Electric traffic. The `migrate` Job's hints are in [Migrations](#migrations).

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
