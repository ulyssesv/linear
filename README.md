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

Node and pnpm are pinned in `mise.toml`. With [mise](https://mise.jdx.dev) installed and
activated in your shell, `mise install` gets the exact versions, verified against
`mise.lock`; nothing else needs installing by hand.

```sh
mise install
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

### Local environment

Public pages need nothing more. Sign-in, `/sheets` and the CLI's `serve` and `scheduler`
need the variables in `.env.example`. Keep them in one `.env` at the root of the main
checkout: `mise.toml` loads that file into the shell of the checkout and of every
worktree, wherever it lives, so a rotated value changes in one place. Git ignores `.env`.

1. Create a development OAuth app in Linear (Settings, API, OAuth applications), apart
   from the production one: callback URL `http://localhost:3000/auth/linear/callback`,
   client credentials enabled, webhooks off. Without a public tunnel Linear cannot reach
   localhost, so the scheduler keeps the local mirror current instead of webhooks.
2. `cp .env.example .env` in the main checkout and fill it: the app's client id and
   secret, `openssl rand -base64 32` for `SESSION_SECRET` and for `TOKEN_ENCRYPTION_KEY`,
   any value for `LINEAR_WEBHOOK_SECRET`, your email for `SIGNIN_ALLOWLIST`. Never reuse a
   production value.
3. `cd` out and back in (or open a new shell) so mise loads it; `mise env` shows the
   names with values redacted.
4. Prepare the database and fill the mirror once, then start the server:

```sh
pnpm db:up
pnpm build
node apps/web/dist/cli.mjs migrate
node apps/web/dist/cli.mjs scheduler   # rerun to pick up changes made in Linear
pnpm dev                               # sign in at http://localhost:3000/sign-in
```

No test uses the credentials or secrets from `.env`, and its `DATABASE_URL` is the
compose database the tests fall back to anyway. The e2e server runs with fixed fakes and
blanks every other name it reads, so `SIGNIN_ALLOWLIST` does not reach it.

## Run

One container image, `ghcr.io/ulyssesv/linear`, published on every `v*` release.
`docs/deploy.md` is the full contract: port 3000, `/healthz` and `/readyz`, entrypoint
commands, security context and resource hints.

Every command validates the environment it needs at startup and exits non-zero naming
each missing or invalid variable; `docs/deploy.md` lists them all.

## Process

Start here:

- `AGENTS.md`: how work flows through specs, Linear and pull requests.
- `docs/specs/README.md` and `docs/records/README.md`: file formats.
- `docs/specs/001-seed.md`: the seed spec.
- `docs/records/`: decision records.
- `docs/deploy.md`: the hand-off to infra.
