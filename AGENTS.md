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
- `apps/web`: the single deployable. `packages/`: code shared by applications. `tools/`: repository tooling. (Created by the seed spec.)
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
   mirror again, reply on each thread with what changed.
3. On approval, create the issues and move the parent forward.
4. One issue at a time: branch with Linear's branch name, red-green-refactor with tests
   that cite requirement ids, one pull request per issue with a Conventional Commits
   title, issue to In Review once the pull request is ready, review in Linear Diffs,
   squash merge. The author approves and merges on GitHub.
5. release-please opens a release pull request; merging it tags `v*`, which builds and
   publishes the container image. Infra pins the digest and rolls it out.

## Conduct

- For each issue, commit, push and open the pull request without asking first. When it
  is ready for review, move the issue to In Review in Linear (the branch name moved it
  to In Progress; the merge moves it to Done). Then post a summary in the chat: what changed, the manual steps needed (setup, secrets,
  settings outside the repository), and how to verify the change by hand. The author
  reviews in the pull request or in the chat; address the feedback on the same branch
  and post an updated summary. Never merge; the author approves and merges on GitHub.
- Every change to `main` goes through a pull request. No direct pushes after the seed
  commit.
- Specs state testable requirements. Design notes explain; they do not legislate.
- Keep the mirror current: `pnpm linear:sync` once it exists, by hand through the Linear
  API until then.
- Prefer no new dependency over a small convenience. A few lines in a workflow beat a
  third-party action.
- Keep `.gitattributes` review categories accurate when adding paths, so Linear Diffs
  groups files correctly.

## Commands

Node 26 and pnpm 12, pinned by `.nvmrc` and `packageManager`. Kept current as the seed
spec lands.

| Command | What |
|---|---|
| `pnpm install` | Install the workspace |
| `pnpm check` | lint, typecheck, test, check:specs in sequence; what CI runs |
| `pnpm lint` | Biome lint and format check (`biome ci`); Markdown is excluded |
| `pnpm format` | Apply Biome fixes and formatting |
| `pnpm typecheck` | `tsc` in every package |
| `pnpm test` | Unit tests in every package |
| `pnpm check:specs` | Spec and record structure, requirement traceability (T2) |
| `pnpm dev`, `build`, `test:e2e` | Web app (T3 to T5) |
| `pnpm linear:sync` | Mirror specs and records to Linear (T9) |
