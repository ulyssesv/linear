# Records

Format reference for `docs/records`: decision records for architecture, process and
product. The process around them is in `AGENTS.md`.

## Files

`docs/records/NNN-slug.md`. `NNN` is zero-padded, assigned in order and never reused.

## Front matter

```yaml
---
id: REC-001
title: Code is the source of truth; Linear mirrors it
status: accepted          # proposed | accepted | retired | superseded
date: 2026-11-01          # date of the decision; later edits do not change it
area: site-platform       # site-platform | planning-sheet | metrics-rollup | ai-sdlc | infra
spec: SEED                # spec that prompted the record, optional
supersedes: []            # record ids this one replaces
linear:
  initiative: https://linear.app/sesv/initiative/...
  document: https://linear.app/sesv/document/...   # filled after the first mirror
---
```

## Body

Free form. Context, decision, alternatives considered and consequences are the usual
shape. A record can be edited at any time. When a decision no longer holds, set the
status to `retired`, or to `superseded` and list it under `supersedes` in the record
that replaces it.

## Mirror

Each record is mirrored as a document titled `REC-NNN <title>` on the initiative in its
front matter, by `pnpm linear:sync` and the `linear-sync.yml` workflow, in the same way
as specs (see `docs/specs/README.md`). The file is the source of truth.

`pnpm check:specs` validates record front matter: an id matching the file number, a
title, a known status and area, a date and a Linear initiative URL.
