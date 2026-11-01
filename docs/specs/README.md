# Specs

Format reference for `docs/specs`. The process around specs (lifecycle, Linear mapping,
how a session works) is in `AGENTS.md` at the repository root.

## Files

`docs/specs/NNN-slug.md`. `NNN` is zero-padded, assigned in order and never reused.
`slug` is kebab-case. One flat file per spec.

## Front matter

```yaml
---
id: SEED                  # uppercase key, unique across specs; requirement ids are <id>-R<n>
title: Seed the repository, process, delivery pipeline and placeholder site
status: draft             # draft | approved | implementing | done | superseded
area: site-platform       # site-platform | planning-sheet | metrics-rollup | ai-sdlc | infra
linear:
  initiative: https://linear.app/sesv/initiative/...   # the area
  parent: https://linear.app/sesv/project/...          # project or issue the spec belongs to
  document: https://linear.app/sesv/document/...       # filled after the first mirror
supersedes: []            # spec ids this one replaces
created: 2026-11-01
---
```

## Body

Free form. The author picks the sections that fit the spec. Context, goals and
non-goals, requirements, design notes, validation, tasks, open questions, decisions and
references are common; none is mandatory. Two kinds of line have a fixed shape so that
tooling can read them: requirement lines and task lines.

## Requirement lines

One list item per requirement:

```
- **SEED-R7** (unit) The checker rejects a requirement line without a tag.
```

The tag says how the requirement is verified:

| Tag | Meaning |
|---|---|
| `unit` | Cited by at least one Vitest test |
| `e2e` | Cited by at least one Playwright test |
| `check` | Enforced by a CI step, script or config; the step name or a comment cites the id |
| `manual` | Verified by a person; listed in the pull-request checklist |
| `dropped` | No longer required; the line stays so ids remain stable and says why |

A test cites a requirement by putting the id in its name or in a `// @req` comment:

```ts
it("SEED-R7 rejects a requirement line without a tag", () => { ... })
// @req SEED-R7
```

`pnpm check:specs` enforces citations once a spec reaches `done`: every `unit` or `e2e`
requirement must be cited by a test. Before that it lists uncited requirements as
pending. A citation of an id that no spec defines fails at any status.

Ids are never renumbered or reused.

## Task lines

An ordered checklist. Each item carries a `T<n>` id and ends with the requirement ids
it covers in parentheses, without the spec prefix: single ids, comma-separated lists and
ranges written `R1 to R6`. An item may wrap over indented continuation lines:

```
- [ ] T2 Spec checker with tests (R8, R9)
- [ ] T1 Workspace scaffold (R1 to R6)
```

Every task names at least one requirement, and every requirement not tagged `dropped`
is named by at least one task, so nothing is specified without a task to build it.
`pnpm check:specs` enforces both (SEED-R30), and also fails when a task names an id the
spec does not define. Anything else in the trailing parenthesis, such as a prefixed
`(SEED-R8)` or a backward range, counts as naming nothing.

Each task becomes an issue under the spec's Linear parent (an issue of the project, or a
sub-issue of the issue), titled `T<n> <task>`.

## Mirror

Each spec is mirrored as a document titled `SPEC-NNN <title>` on the Linear parent in
its front matter. The body is the file after the front matter, without the leading H1,
under one line that links the file at the synced commit. `linear-sync.yml` runs
`pnpm linear:sync` on every push to `main` that touches `docs/specs` or `docs/records`;
the script finds the document by its title prefix, so runs never duplicate it. The file
is the source of truth; edits made in Linear are overwritten.
