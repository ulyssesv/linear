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
| `scheduler`, `migrate` | Reserved. Exit with code 2 and a message naming the spec that will implement them, so a Job or CronJob fails loudly until then |
| Shutdown | Graceful on `SIGTERM` |
| Logs | stdout and stderr; one start line with version, commit and `PUBLIC_URL` |

## Probes

Both answer on the app port, with `cache-control: no-store`.

| Probe | Path | Healthy | Unhealthy |
|---|---|---|---|
| Liveness | `/healthz` | 200 `{"status":"ok","version":"0.1.0","commit":"<sha>"}` | no answer |
| Readiness | `/readyz` | 200 `{"status":"ok","checks":{...}}` | 503 `{"status":"fail","failing":["db"],"checks":{...}}` |

`/healthz` answers whenever the process can serve requests and is also how the smoke
workflow checks the deployed commit. `/readyz` runs every registered readiness check
with a timeout; each entry in `checks` is `{"status":"ok"}` or
`{"status":"fail","error":"..."}`. The current
release registers none, so it always returns 200 with `"checks":{}`. The planning sheet
will register the database.

## Environment

The server validates its environment at startup and exits non-zero listing every
missing or invalid variable.

Required, with defaults:

| Name | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Listen port, integer 1 to 65535 |
| `PUBLIC_URL` | `http://localhost:3000` | External origin, `http` or `https`, no path. Set to `https://linear.sesv.co` |

Reserved: accepted and passed through unvalidated, unused until the spec that needs them
gives them a schema. Infra need not set them yet.

| Name | Planned use |
|---|---|
| `DATABASE_URL` | Postgres, direct and unpooled |
| `ELECTRIC_URL` | In-cluster Electric service |
| `ELECTRIC_SECRET` | Shared with Electric; the app attaches it, clients never see it |
| `SESSION_SECRET` | Session signing |
| `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` | Linear OAuth app |

The list lives in `apps/web/src/server/env.ts`. New names arrive with the spec that uses
them and are added here in the same pull request.

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
/tmp`) through `tools/container-smoke.sh` before it is published.

## Resources

Measured locally on the seed image: about 40 MiB resident after start and a few
landing-page requests, near-zero CPU at idle. Suggested starting point for one replica:

```yaml
resources:
  requests: { cpu: 50m, memory: 128Mi }
  limits: { memory: 256Mi }
```

No CPU limit, to avoid throttling server rendering. Revisit when the planning sheet adds
Postgres and Electric traffic.

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
