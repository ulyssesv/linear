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

Requires Node 26 (`.nvmrc`) and pnpm 12 (pinned by `packageManager`).

```sh
pnpm install
pnpm check        # lint, typecheck, unit tests, spec checks
```

Root scripts: `dev`, `build`, `test`, `test:e2e`, `lint`, `format`, `typecheck`,
`check:specs`, `linear:sync`, `check`. Layout: `apps/web` is the site, `packages/` holds
code shared by applications, `tools/` holds repository tooling.

The environment contract is documented once the server lands (spec SEED, T10).

Start here:

- `AGENTS.md`: how work flows through specs, Linear and pull requests.
- `docs/specs/README.md` and `docs/records/README.md`: file formats.
- `docs/specs/001-seed.md`: the seed spec.
- `docs/records/`: decision records.
