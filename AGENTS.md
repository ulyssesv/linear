# AGENTS.md

## What this is

The repository behind https://linear.sesv.co: proofs of concept and documentation for
proposals to Linear. Work is organised in areas:

| Area | Key | What |
|---|---|---|
| Site platform | `site-platform` | This repository, its process and its delivery pipeline |
| Planning sheet | `planning-sheet` | A spreadsheet-like surface over Linear initiatives and projects |
| Metrics rollup | `metrics-rollup` | Goals tied to metrics, rolled up from issues to projects to initiatives |
| AI SDLC | `ai-sdlc` | Linear alongside specs, decision records and glossaries whose source of truth is a repository |
| Infra | `infra` | Running the site on the homelab cluster, delivered through the separate infra repository |

## Source of truth

Code and the files under `docs/` are the source of truth. Linear holds tracking state:
initiatives, projects, issues, statuses, reviews, comments. Specs and records are
mirrored one way into Linear documents. Feedback left in Linear is applied to the file,
the file is mirrored again, and the thread gets a reply saying what changed. Nothing
flows from Linear into files automatically.

## Where things are

- `docs/specs/NNN-slug.md`: what to build, with requirement ids that tests cite. Format in `docs/specs/README.md`.
- `docs/records/NNN-slug.md`: decisions. Format in `docs/records/README.md`.
- `apps/web`: the single deployable. `packages/`: code shared by applications. `tools/`: repository tooling.
- `apps/web/src/server/db`: Postgres access (`database()`, `createSql()`) and the
  migration runner. Migrations are `migrations/NNNN_slug.sql`, applied in order by the
  image's `migrate` command; add the next number, never edit a released one.
- `apps/web/content/*.mdx`: the copy of the site's pages, one MDX file per page with
  `export const meta = { title, description }`. Routes render it with `ContentPage` from
  `apps/web/src/components/content.tsx`, which also holds the components copy may use.
  Every page sits in the shell of `routes/__root.tsx`: header, `<main>`, footer. Links
  between pages use `SiteLink` (`components/site-link.tsx`), which navigates without
  reloading the document; MDX links get it automatically. Photos are WebP files under
  `apps/web/content/images`, one per width (`name-<width>.webp`, made with `cwebp`),
  registered in `src/images.ts` and shown with `Photo`, or `<Figure image="name" />` in
  copy; a test enforces the format, the size budget and the declared sizes.
- `apps/web/THIRD_PARTY.md`: every font, icon set and library the site ships, with its
  licence. A test fails when a runtime dependency or a package imported by `styles.css`
  is missing there. Fonts are self-hosted from `@fontsource-variable` packages; icons are
  Lucide paths inlined in `components/icons.tsx`. No Linear logo or asset, except Linear's
  logomark, unaltered, in `components/linear-mark.tsx` and only on the sign-in controls
  (CONTENT-R16).
- `apps/web/src/server/auth`: sign in with Linear, sessions and encrypted per-user tokens.
  Routes under `/sheets` require a session; signed-in end-to-end tests use the `signIn`
  fixture of `apps/web/e2e/auth.ts`, which writes a session to the e2e database.
- `.env` at the root of the main checkout: the local secrets for sign-in, `serve`,
  `scheduler` and the Linear tools, loaded by `mise.toml` into every worktree's shell
  through git's common directory. Gitignored; `.env.example` lists the names and README.md,
  "Local environment", the setup with a development OAuth app. Never put a production value
  in it. The e2e server ignores it except `DATABASE_URL`.
- `compose.yaml`: the local Postgres, also started by CI. Tests and the dev server use it
  unless `DATABASE_URL` says otherwise.
- `docs/deploy.md`: the hand-off to infra: image, port, probes, env contract, security context.
- `.github/workflows/`: `ci.yml`, `release.yml`, `smoke.yml`, `linear-sync.yml`.
  `.github/actions/setup`: Node, pnpm and dependencies for every workflow that runs pnpm.
- Working notes, drafts and hand-offs go in `.context/` at the repository root, the
  agent scratchpad. Git ignores it; nothing in it is a deliverable or a source of truth.

## Linear mapping

- One initiative per area.
- A spec belongs to a project or to an issue; its front matter names that parent. The spec is mirrored as a document titled `SPEC-NNN <title>` on the parent.
- Each task of a spec is an issue under the parent: an issue of the project, or a sub-issue of the issue. Titled `T<n> <task>`.
- Records are mirrored as `REC-NNN <title>` documents on their area initiative.
- Pull requests attach to issues through Linear's branch names and are reviewed in Linear Diffs.

## Spec lifecycle

| Status | Meaning | Linear |
|---|---|---|
| draft | Written in a session, open for review | Document mirrored; parent in Backlog |
| approved | Accepted by the author | Tasks become issues; parent Planned (project) or Todo (issue) |
| implementing | Work started | Parent In Progress |
| done | All tasks closed, traceability green, deployed where applicable | Parent Completed or Done |
| superseded | Replaced by a later spec, linked both ways | Document kept |

Records have their own statuses: `proposed`, `accepted`, `retired`, `superseded`. They
can be edited at any time.

## The loop

1. Interview first. A new spec starts with questions to the author about scope and
   alternatives. Decide only what the spec needs now and defer the rest to the spec that
   will need it.
2. Write the spec, mirror it to Linear, stop for review. Address comments in the file,
   mirror again, reply on each thread with what changed. A draft on a branch is mirrored
   with `pnpm linear:sync`; once merged, `linear-sync.yml` keeps the mirror current.
3. On approval, create the issues and move the parent forward.
4. One issue at a time: branch with Linear's branch name, red-green-refactor with tests
   that cite requirement ids, one pull request per issue with a Conventional Commits
   title, issue to In Review once the pull request is ready, review in Linear Diffs,
   squash merge. The author approves and merges on GitHub.
5. release-please keeps a release pull request open on `main` with the next version and
   `CHANGELOG.md`. Merging it tags `v*` and creates the GitHub release; `release.yml`
   builds the image, smoke-tests it and publishes it to GHCR with the
   `<tag>@sha256:...` reference in the release notes. Infra pins that reference and
   rolls it out (`docs/deploy.md`); the `smoke` workflow confirms the served commit.

## Conduct

- For each issue, commit, push and open the pull request without asking first. When it
  is ready for review, move the issue to In Review in Linear (the branch name moved it
  to In Progress; the merge moves it to Done). Then post a summary in the chat: what changed, the manual steps needed (setup, secrets,
  settings outside the repository), and how to verify the change by hand. The author
  reviews in the pull request or in the chat; address the feedback on the same branch
  and post an updated summary. Never merge; the author approves and merges on GitHub.
- A push is done when CI on the pushed commit is done. Ready for review means CI is
  green on the pull request's head commit, not only locally; the summary names the run.
  When CI fails, keep the issue In Progress, diagnose from the failed step's log and push
  one fix. If CI fails again, stop and raise it with the author with the diagnosis
  instead of trying again.
- Every change to `main` goes through a pull request. No direct pushes after the seed
  commit.
- Specs state testable requirements. Design notes explain; they do not legislate.
- Keep the mirror current. `linear-sync.yml` mirrors on every push to `main` that touches
  `docs/specs` or `docs/records`; run `pnpm linear:sync` yourself only to mirror a draft
  from a branch. Both need `LINEAR_API_KEY`.
- Prefer no new dependency over a small convenience. A few lines in a workflow beat a
  third-party action.
- Keep `.gitattributes` review categories accurate when adding paths, so Linear Diffs
  groups files correctly.

## Commands

Node 26 and pnpm 12, pinned in `mise.toml` with checksums in `mise.lock`. With mise
activated in the shell, `mise install` sets both up; `packageManager` and `engines` in
`package.json` agree with it, and pnpm switches itself to `packageManager` regardless.
Workflows set up through `.github/actions/setup`, which installs the same versions with
mise. The Dockerfile pins Node by its base image and gets pnpm through corepack. Bump a
version in all of those places, then run `mise lock`. Postgres is pinned by tag and
digest in `compose.yaml` only; CI and the container smoke take the image from there.
Docker runs it locally. Keep this table current when a script is added or changes.

| Command | What |
|---|---|
| `mise install` | Install Node and pnpm from `mise.toml` |
| `mise lock` | Refresh `mise.lock` checksums after a version bump in `mise.toml` |
| `pnpm install` | Install the workspace |
| `pnpm check` | lint, typecheck, test, check:specs in sequence; the first half of CI |
| `pnpm lint` | Biome lint and format check (`biome ci`); Markdown is excluded |
| `pnpm format` | Apply Biome fixes and formatting |
| `pnpm typecheck` | `tsc` in every package |
| `pnpm db:up` | Start the Postgres from `compose.yaml` on `localhost:55432` and wait until it is ready |
| `pnpm db:down` | Stop it, keeping the data; `docker compose down --volumes` also drops the data |
| `pnpm test` | Unit tests (Vitest) in every package; tests that touch Postgres need `pnpm db:up` and fail without it |
| `pnpm check:specs` | Spec and record structure, task coverage, requirement traceability |
| `pnpm dev` | Web app with Vite at http://localhost:3000 |
| `pnpm build` | Production build into `apps/web/dist`; `APP_VERSION` and `APP_COMMIT` set the build info |
| `node apps/web/dist/cli.mjs [serve\|migrate]` | Run the build; `DATABASE_URL`, `PORT` and `PUBLIC_URL` per `docs/deploy.md` |
| `pnpm test:e2e` | Playwright `local` project: migrates, then runs the built server on port 3100 (`E2E_PORT` overrides); run `pnpm build` and `pnpm db:up` first |
| `pnpm test:smoke` | Playwright `smoke` project against `BASE_URL`, asserting `EXPECTED_COMMIT` when set |
| `pnpm smoke:container <image>` | Run an image under the production security flags against a throwaway Postgres: `migrate`, `/healthz`, `/readyz`, `scheduler` |
| `pnpm linear:sync [--dry-run]` | Mirror specs and records to Linear documents; `--dry-run` prints the plan and writes nothing |
| `pnpm seed:fixtures [--dry-run]` | Seed the planning sheet fixtures under the `Test` team hierarchy with a personal `LINEAR_API_KEY`; idempotent, never deletes; `--dry-run` prints the plan and writes nothing; `--help` for options |

Playwright needs Chromium once per machine:
`pnpm --filter @sesv/web exec playwright install chromium` (add `--with-deps` on Linux).
`docker build --build-arg APP_VERSION=<v> --build-arg APP_COMMIT=<sha> -t <image> .`
builds the image.
