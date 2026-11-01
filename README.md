# linear.sesv.co

Proofs of concept and documentation for proposals to Linear, served at
https://linear.sesv.co.

Areas:

- Planning sheet: a spreadsheet-like surface over Linear initiatives and projects.
- Metrics rollup: goals tied to metrics, rolled up from issues to projects to initiatives.
- AI SDLC: Linear alongside specs, decision records and glossaries whose source of truth is the repository.
- Site platform: this repository, its process and delivery pipeline.
- Infra: running the site on the homelab cluster through the separate infra repository.

Status: scaffolding. The first spec, `docs/specs/001-seed.md`, is being implemented.

## Develop

Requires Node 26 (`.nvmrc`) and pnpm 12 (pinned by `packageManager`). Node 26 no longer
ships corepack; install it once with `npm i -g corepack@0.36.0 && corepack enable`.

```sh
pnpm install
pnpm dev          # http://localhost:3000
pnpm check        # lint, typecheck, unit tests, spec checks
pnpm build        # production build into apps/web/dist
pnpm test:e2e     # Playwright against the build; needs Chromium once:
                  # pnpm --filter @sesv/web exec playwright install chromium
node apps/web/dist/cli.mjs   # serve the build
```

Every root script is listed in `AGENTS.md`. Layout: `apps/web` is the site, `packages/`
holds code shared by applications, `tools/` holds repository tooling.

## Run

One container image, `ghcr.io/ulyssesv/linear`, published on every `v*` release.
`docs/deploy.md` is the full contract: port 3000, `/healthz` and `/readyz`, entrypoint
commands, security context and resource hints.

Environment, validated at startup (the server exits non-zero listing what is wrong):

| Name | Default | |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `PUBLIC_URL` | `http://localhost:3000` | External origin, `https://linear.sesv.co` in production |
| `DATABASE_URL`, `ELECTRIC_URL`, `ELECTRIC_SECRET`, `SESSION_SECRET`, `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` | | Reserved for the planning sheet; accepted, unused |

## Process

Start here:

- `AGENTS.md`: how work flows through specs, Linear and pull requests.
- `docs/specs/README.md` and `docs/records/README.md`: file formats.
- `docs/specs/001-seed.md`: the seed spec.
- `docs/records/`: decision records.
- `docs/deploy.md`: the hand-off to infra.
