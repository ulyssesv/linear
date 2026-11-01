<!--
Title: Conventional Commits, `type(scope)!: subject`. CI rejects anything else (SEED-R16).
Branch: the issue's Linear branch name, so the pull request attaches to the issue.
-->

[LIN-NNN](https://linear.app/sesv/issue/LIN-NNN) · Spec SEED, task T<n> · Covers SEED-R<n>

## What

<!-- What changed and why, by file or area. Name any new dependency and why it earns its place. -->

## Requirements

<!-- One row per requirement id covered, with where it is verified. -->

| Id | Verification |
| -- | -- |
| SEED-R<n> | unit: `path/to/file.test.ts` |

- [ ] Every `unit` and `e2e` id above is cited by a test name or a `// @req` comment
- [ ] Every `check` id above is cited by the CI step, script or config that enforces it
- [ ] `pnpm check` passes and `check:specs` reports 0 errors

## Manual verification

<!-- What was run by hand and what it showed. Manual requirement ids are verified here. -->

- [ ]

## Manual steps for the author

<!-- Setup, secrets, settings outside the repository, merge order. "None." if none. -->

None.
