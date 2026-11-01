---
id: REC-003
title: Repository shape and toolchain
status: accepted
date: 2026-11-01
area: site-platform
spec: SEED
supersedes: []
linear:
  initiative: https://linear.app/sesv/initiative/site-platform-6ac5ff8c3199
  document: https://linear.app/sesv/document/rec-003-repository-shape-and-toolchain-2c4de5bac50a
---

# REC-003: Repository shape and toolchain

## Context

One repository will hold three proofs of concept, the documentation space and later a
scheduler workload, all deployed as one image. The planning-sheet draft fixed the
language and framework; the rest was open.

## Decision

| Concern | Choice |
|---|---|
| Repository | `ulyssesv/linear`, public, MIT |
| Layout | pnpm workspace; `apps/web` is the single deployable; `packages/` for code shared by applications; `tools/` for repository tooling |
| Runtime | Node LTS pinned in `.nvmrc`; pnpm pinned by `packageManager` |
| Framework | TanStack Start with React, server rendering on by default and disabled per route where needed, built as a plain Node server |
| UI | Tailwind, shadcn/ui |
| Lint and format | Biome, single config |
| Tests | Vitest for unit and component tests; Playwright for end to end and production smoke |
| Commits and releases | Conventional Commits enforced on pull-request titles; squash merges; release-please for changelog, version and tags |
| Docs | Flat numbered specs in `docs/specs`, flat numbered records in `docs/records`; working notes stay out of the repository |

## Alternatives considered

- Single package. Fastest to seed, but the scheduler entrypoint, the tooling package
  and shared code would all end up in one `package.json`.
- Separate docs application (Astro Starlight, Fumadocs). Two services behind one host
  from day one; the docs space is better served by the same app rendering `docs/`.
- ESLint with Prettier. Larger ecosystem, slower, two configurations.
- Bun as runtime and package manager. Less exercised with TanStack Start's server
  build and would need its own base image.
- Changesets. Needs a file per pull request; Conventional Commits already carry the
  same information.

## Consequences

- Biome's rule set is narrower than typescript-eslint's; accepted for a proof of
  concept.
- MIT is revisited if HyperFormula (GPLv3) is adopted by the planning sheet.
- release-please opens a release pull request after each merge to `main`; releases
  happen when that pull request is merged, not on every merge.
