---
id: SEED
title: Seed the repository, process, delivery pipeline and placeholder site
status: implementing
area: site-platform
linear:
  initiative: https://linear.app/sesv/initiative/site-platform-6ac5ff8c3199
  parent: https://linear.app/sesv/project/scaffold-674a01efb950
  document: https://linear.app/sesv/document/spec-001-seed-the-repository-process-delivery-pipeline-and-placeholder-ad4e7895214f
supersedes: []
created: 2026-11-01
---

# SEED: Seed the repository, process, delivery pipeline and placeholder site

## 1. Context

linear.sesv.co will host proofs of concept and documentation for proposals to Linear:
a spreadsheet-like planning surface over initiatives and projects, metric roll-ups
across issues, projects and initiatives, and Linear operating alongside AI-era SDLC
artifacts such as specs, decision records and glossaries. Each is its own area with its
own specs. This spec seeds what they share: the repository, the development process,
the delivery pipeline and a first page at the public hostname.

The repository will carry one web application, TypeScript on TanStack Start, later
backed by Postgres and Electric for the planning sheet, together with the specs and
records that document every proposal. It deploys as one public container image to the
homelab Kubernetes cluster. The separate infra repository owns the cluster, ingress,
DNS and secret values, and rolls out each release by pinning the image digest. This
repository ships the image and a documented contract: port, health paths, environment
variable names and the security context the image supports.

The decisions taken while shaping this spec are recorded in REC-001 to REC-003.

## 2. Goals and non-goals

Goals:

- A repository layout the planning sheet can grow into without restructuring.
- A development process that uses Linear for tracking, documents and code review, with
  code as the source of truth and specs mirrored into Linear.
- A delivery pipeline: checks on every pull request, and a release that produces a
  public container image with a digest infra can pin.
- A placeholder landing page served at https://linear.sesv.co once infra wires it.

Non-goals:

- Postgres, Electric, authentication, the scheduler, the Linear OAuth app. These belong
  to the planning-sheet specs.
- Rendering `docs/` as pages on the site. Next site-platform spec.
- Helm chart, Argo Application, ingress, DNS, secret values. Infra repository.
- Pull-request environments. Not available on the homelab.
- Linear coding sessions and agent workflows.
- Creating Linear issues from spec tasks automatically. Done by hand at approval for
  now; a later version of the sync script may take it over.

## 3. Requirements

### Repository

- **SEED-R1** (check) The repository is a pnpm workspace with `apps/web` as the only
  application, a `packages/` directory reserved for code shared between applications,
  and `tools/` for repository tooling. Root scripts `dev`, `build`, `test`, `test:e2e`,
  `lint`, `typecheck`, `check:specs`, `linear:sync` and `check` (lint, typecheck, test,
  check:specs in sequence) exist and are what CI calls.
- **SEED-R2** (check) Node and pnpm versions are pinned through `.nvmrc` and the
  `engines` and `packageManager` fields of the root `package.json`. CI installs from
  those.
- **SEED-R3** (check) Biome is the only linter and formatter. `pnpm lint` fails on any
  lint or format diagnostic and CI runs it.
- **SEED-R4** (check) TypeScript runs in strict mode in every package and
  `pnpm typecheck` covers the whole workspace.
- **SEED-R5** (manual) The root holds `LICENSE` (MIT), `README.md` (purpose, how to run,
  env contract, pointer to the process), `AGENTS.md`, `CLAUDE.md` (symlink), `.gitignore` and
  `.nvmrc`.
- **SEED-R6** (check) `.gitattributes` assigns Linear review categories: `docs/**` as
  review-documentation, test files as review-test, `pnpm-lock.yaml` as
  linguist-generated, agent guidance files as review-agent-guidance.

### Specs and records

- **SEED-R7** (manual) `docs/specs/README.md` and `docs/records/README.md` define the
  file formats; `AGENTS.md` defines the process, the lifecycle and the Linear mapping.
  This spec and REC-001 to REC-003 follow them.
- **SEED-R8** (unit) `pnpm check:specs` parses every spec and record and fails when
  front matter is missing or invalid (unknown status or area, missing Linear parent),
  when a spec id or requirement id is duplicated, or when a requirement or task line is
  malformed.
- **SEED-R9** (unit) `pnpm check:specs` fails when a test cites an id that no spec
  defines, or when a spec with status `done` has a requirement tagged `unit` or `e2e`
  that no test file cites. For a spec in any other status it lists those uncited
  requirements as pending without failing. Dropped requirements are exempt.

### Linear mirror

- **SEED-R10** (unit) `pnpm linear:sync` creates or updates one Linear document per spec,
  on the project or issue named in its front matter, and one per record, on the
  initiative named in its front matter. Titles are `SPEC-NNN <title>` and
  `REC-NNN <title>`. The script finds an existing document by its title prefix and
  updates it in place, so repeated runs never create duplicates.
- **SEED-R11** (unit) The mirrored body is the markdown after the front matter, minus a
  leading H1 that repeats the title, preceded by one line that links the source file at
  the synced commit and says the file is the source of truth.
- **SEED-R12** (check) A workflow runs `linear:sync` on every push to `main` that touches
  `docs/specs` or `docs/records`, authenticated with a `LINEAR_API_KEY` repository
  secret. On pull requests it runs with `--dry-run` and prints the plan.
- **SEED-R13** (unit) `linear:sync --dry-run` performs no writes and lists every create
  or update it would perform.

### Process

- **SEED-R14** (manual) `AGENTS.md` describes the loop end to end: write the spec,
  mirror, review, approve, create issues, one branch per issue using Linear's branch
  name, red-green-refactor, one pull request per issue, review in Linear Diffs, squash
  merge, release, image, infra bump. Its commands section is kept current as tooling
  lands.
- **SEED-R15** (manual) A pull-request template asks for the spec and requirement ids
  covered, confirms the tests cite them, and lists the manual verifications performed.
- **SEED-R16** (check) Pull-request titles follow Conventional Commits. An inline step in
  `ci.yml`, with no third-party action, rejects titles that do not match. Squash merges
  carry the title into `main`. release-please maintains `CHANGELOG.md`, the version and
  the `v*` tag from merged titles.

### Placeholder site

- **SEED-R17** (e2e) `GET /` renders the site name, a one-paragraph purpose, one card per
  proof of concept (planning sheet, metrics rollup, AI SDLC) with a status label and a
  link to its Linear initiative or spec, a link to the GitHub repository, and a footer
  with the deployed version and short commit SHA.
- **SEED-R18** (unit) The landing route is server-rendered and readable with JavaScript
  disabled. Later routes may opt out of server rendering individually.
- **SEED-R19** (manual) Styling uses Tailwind with the shadcn/ui baseline and follows the
  system light or dark preference.
- **SEED-R20** (e2e) `GET /healthz` returns 200 with `status`, `version` and `commit`
  whenever the process can serve requests. `GET /readyz` returns 200 with `status` and
  a `checks` object when every registered readiness check passes, and 503 naming the
  failing checks otherwise. The seed registers no checks; the planning sheet registers
  the database.
- **SEED-R21** (unit) Version and commit come from build-time values `APP_VERSION` and
  `APP_COMMIT` injected by the Docker build and surfaced by `/healthz` and the page
  footer. Local builds fall back to `dev` and the git HEAD.
- **SEED-R22** (unit) The server validates its environment at startup against a schema
  and exits non-zero listing the missing or invalid variables. The seed requires only
  `PORT` (default 3000) and `PUBLIC_URL` (default `http://localhost:3000`); every other
  name in the env contract is declared optional and reserved.

### Container and delivery

- **SEED-R23** (check) A multi-stage `Dockerfile` builds the app with pnpm and produces a
  runtime image on the pinned Node LTS slim base that runs as a non-root uid and works
  under `runAsNonRoot`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`,
  `seccompProfile: RuntimeDefault` and a read-only root filesystem. CI runs the image
  under the equivalent Docker flags and requires `/healthz` to answer.
- **SEED-R24** (e2e) The image has one entrypoint with subcommands. `serve` (default)
  starts the web server. `scheduler` and `migrate` are reserved: they exit with code 2
  and a message naming the spec that will implement them, so a CronJob never reports
  success for work that did not happen.
- **SEED-R25** (check) `ci.yml` runs on pull requests and on pushes to `main`: install,
  lint, typecheck, unit tests, spec checks, build, end-to-end tests against the built
  server, Docker build and container smoke. Each step name cites the requirement ids it
  enforces.
- **SEED-R26** (check) `release.yml` runs on `v*` tags: builds the image for
  `linux/amd64`, pushes `ghcr.io/ulyssesv/linear:<tag>` and `:sha-<short>`, and writes
  the `<tag>@sha256:...` reference into the GitHub release notes and the job summary.
  The package is public.
- **SEED-R27** (e2e) A Playwright project `smoke` runs the landing and health checks
  against `BASE_URL` and, when `EXPECTED_COMMIT` is set, asserts the served commit
  matches it. `smoke.yml` exposes it on manual dispatch with those two inputs and runs
  on GitHub-hosted runners, since `linear.sesv.co` is public.
- **SEED-R28** (manual) `docs/deploy.md` is the hand-off to infra: image reference
  format, port, probe paths, env contract with required and reserved names, the security
  context the image supports, resource hints, public hostname, and the note that
  `linear.sesv.co` currently resolves to a private address (10.0.10.53) and must be
  repointed.

## 4. Design notes

Layout:

```
.
├── apps/web/                   TanStack Start app (React, Tailwind, shadcn/ui)
│   ├── src/routes/             /  /healthz  /readyz
│   ├── src/server/             env schema, readiness registry, build info
│   ├── src/cli.ts              entrypoint: serve | scheduler | migrate
│   └── e2e/                    Playwright projects: local, smoke
├── packages/                   empty until a second application needs shared code
├── tools/specs/                check:specs and linear:sync, a workspace package with tests
├── docs/
│   ├── specs/  records/  deploy.md
├── .github/
│   ├── workflows/              ci.yml  release.yml  smoke.yml  linear-sync.yml
│   └── pull_request_template.md
├── AGENTS.md  CLAUDE.md  Dockerfile  biome.json  pnpm-workspace.yaml  release-please-config.json
```

Tooling as a package. `tools/specs` is a workspace package so the checker and the sync
script are developed test-first like application code, and `tools/` stays distinct
from `packages/`, which is for code shared by applications.

Readiness registry. `registerReadinessCheck(name, fn)` on the server; `/readyz` runs
every check with a timeout and reports per check. The seed registers none. Keeping the
registry now means the planning sheet adds a database check without touching routes.

Build info. The Vite build defines `APP_VERSION` and `APP_COMMIT` from environment
variables; the Dockerfile exposes them as build args and the release workflow passes
the tag and SHA. The same values feed `/healthz` and the footer so the smoke project
can assert what is deployed.

Entrypoint. `node dist/cli.mjs <command>`. The server start is a function separate
from the CLI so unit tests can start it in-process. Reserved commands exit 2 rather
than 0 so a Kubernetes CronJob fails loudly until the real implementation lands.

Server rendering. TanStack Start renders on the server by default; the planning sheet
will disable it per route for the grid. The build targets a plain Node server started
with `node`, behind a TLS-terminating proxy, with `PUBLIC_URL` as the external origin.

Spec checker. Front matter parsed with the `yaml` package and validated against a
schema. Requirement lines match
`^- \*\*([A-Z][A-Z0-9]*)-R(\d+)\*\* \((unit|e2e|check|manual|dropped)\)`; task lines match
`^- \[[ x]\] T(\d+) `. Sections are not checked; the author chooses them. Citations are
found by scanning `*.test.ts`, `*.test.tsx` and `e2e/**/*.ts` for `\b[A-Z][A-Z0-9]*-R\d+\b`.

Sync script. `@linear/sdk` against the GraphQL API. Parent and initiative are resolved
from the URL slug in front matter; a parent URL under `/project/` or `/issue/` decides
where the document attaches. Documents are listed per parent and matched on the
`SPEC-NNN ` or `REC-NNN ` title prefix, then created or updated. The `linear.document`
front-matter field is informational: the author fills it after the first run so humans
can jump from file to mirror. Keying on the title prefix avoids writing ids back from
CI.

Release flow. A few lines of shell in `ci.yml` test the pull-request title against the
Conventional Commits pattern (`type(scope)!: subject`); no third-party action.
release-please in `node` mode keeps one root version and opens a release pull request;
merging it creates the `v*` tag that triggers `release.yml`. Chosen over changesets
because Conventional Commits were already decided and it needs no extra file per pull
request.

Image. Node LTS slim base, `USER 10001`, app under `/app`, writes only to `/tmp`.
Architecture is `linux/amd64` only; the cluster node is amd64.

## 5. Validation

- Unit (Vitest): health handlers, env schema, build-info fallback, CLI dispatch, spec
  checker, sync script against a mocked Linear client. Test names carry requirement ids.
- End to end (Playwright): the `local` project builds and starts the server, then checks
  `/`, `/healthz` and `/readyz`; the `smoke` project runs the same checks against
  `BASE_URL`. A container smoke step runs the image with `--user 10001 --read-only
  --cap-drop ALL --security-opt no-new-privileges` and requests `/healthz`.
- Checks: workflow step names cite ids; `check:specs` verifies structure and
  traceability on every pull request, including for this spec.
- Manual: the pull-request checklist carries the manual ids. Acceptance for the whole
  spec is https://linear.sesv.co serving the landing page with the released commit,
  confirmed by the smoke project.

Order of work. T2 is built first, test-first, and then run against this spec so the
format is enforced before any application code exists. Every later task follows
red-green-refactor: a failing test citing the requirement, the implementation, cleanup.

## 6. Tasks

- [ ] T1 Workspace scaffold: pnpm workspace, Biome, base tsconfig, root scripts,
      `.nvmrc`, `.gitattributes`, README stub (R1 to R6)
- [ ] T2 Spec checker with tests, run against this spec, fix the spec where it fails
      (R8, R9)
- [ ] T3 Web app skeleton: TanStack Start, Tailwind, shadcn baseline, landing route with
      cards and footer (R17 to R19)
- [ ] T4 Server plumbing: env schema, build info, readiness registry, `/healthz`,
      `/readyz`, CLI entrypoint (R20 to R22, R24)
- [ ] T5 Test harness: Vitest config, Playwright `local` and `smoke` projects (R17, R20,
      R27)
- [ ] T6 Dockerfile and container smoke script (R23, R24)
- [ ] T7 CI workflow, including the pull-request title check (R16, R25)
- [ ] T8 Release flow: release-please, release workflow to GHCR, smoke workflow (R16,
      R26, R27)
- [ ] T9 Linear sync script with tests and workflow (R10 to R13)
- [ ] T10 Process docs: `AGENTS.md` commands section, pull-request template,
      `docs/deploy.md`, README env contract (R14, R15, R28)
- [ ] T11 Linear and GitHub setup: GitHub integration with code access for Diffs,
      `LINEAR_API_KEY` secret, GHCR package visibility (manual)
- [ ] T12 First release `v0.1.0`, hand the digest to infra, verify https://linear.sesv.co
      with the smoke project (R27, R28)

## 7. Open questions

1. Linear API key for CI: a personal key for now, or the OAuth app's client-credentials
   token once the planning sheet creates that app.
2. Whether `check:specs` should also require every task to name at least one
   requirement.
3. Resolved in T1: Node 26, the active LTS at scaffold time (promoted 2026-10-28), with
   pnpm 12. Revisited at each LTS promotion.

## 8. Decisions

- REC-001 Code is the source of truth; Linear mirrors it.
- REC-002 Deploy to the homelab cluster through the infra repository's GitOps; this
  repository ships an image.
- REC-003 Repository shape and toolchain.

## 9. References

- Linear Diffs and `.gitattributes` review categories: https://linear.app/docs/diffs
- Linear GraphQL API: https://linear.app/developers/graphql
- TanStack Start hosting: https://tanstack.com/start/latest/docs/framework/react/hosting
- release-please: https://github.com/googleapis/release-please
- Biome: https://biomejs.dev
- Kubernetes Pod Security Standards, baseline: https://kubernetes.io/docs/concepts/security/pod-security-standards/
