---
id: REC-001
title: Code is the source of truth; Linear mirrors it
status: accepted
date: 2026-11-01
area: site-platform
spec: SEED
supersedes: []
linear:
  initiative: https://linear.app/sesv/initiative/site-platform-6ac5ff8c3199
  document: https://linear.app/sesv/document/rec-001-code-is-the-source-of-truth-linear-mirrors-it-3839e55761b7
---

# REC-001: Code is the source of truth; Linear mirrors it

## Context

The site documents proposals for how Linear can work with AI-era SDLC artifacts whose
source of truth is the repository. The process used to build the site should
demonstrate the same thing. Linear offers projects, initiatives, documents, issues and
pull-request review (Diffs); the repository offers versioned files, tests and CI.

## Decision

- Specs (`docs/specs`) and records (`docs/records`) live in the repository and are
  mirrored one way into Linear documents by a script run from CI and from sessions.
- Linear holds tracking state: initiatives, projects, issues, statuses, reviews,
  comments. The repository holds content.
- Mapping: one initiative per area (site platform, planning sheet, metrics rollup,
  AI SDLC, infra). A spec belongs to a project or to an issue. Each task is an issue
  under that parent: an issue of the project, or a sub-issue of the issue. One pull
  request per issue, reviewed in Linear Diffs. Each spec document sits on its parent;
  each record document sits on its area initiative.
- Feedback left on a Linear document is read in the next session and applied to the
  file, then re-mirrored. Nothing flows from Linear into the file automatically.
- Documents are keyed by a title prefix (`SPEC-NNN`, `REC-NNN`) so the mirror is
  idempotent without writing ids back from CI.

## Alternatives considered

- OpenSpec layout (capability specs plus change deltas, archived on completion). More
  ceremony than a proof-of-concept repository needs; revisit if specs start to outlive
  many changes.
- Superpowers-style plans (brainstorm, design doc, step checklist). Plan-centric and
  light on testable requirements, which the traceability check depends on.
- Issues only, never projects, as spec parents. Loses project documents and milestones
  for larger specs.
- Linear documents as the source of truth. Breaks versioning with code and the
  traceability check.

## Consequences

- Needs a Linear API key in CI and an initiative per area before its first spec.
- Renaming a mirrored document in Linear detaches it; the next sync creates a fresh one
  and the old one must be archived by hand.
- Specs carry a status field and tests cite requirement ids; both are enforced by
  `check:specs`.
