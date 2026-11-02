---
id: REC-004
title: Grid is Handsontable behind an adapter, under the non-commercial license
status: accepted
date: 2026-11-02
area: planning-sheet
spec: MIRROR
supersedes: []
linear:
  initiative: https://linear.app/sesv/initiative/planning-sheet-7f1a80410512
  document:
---

# REC-004: Grid is Handsontable behind an adapter, under the non-commercial license

## Context

The planning sheet's hypothesis depends on the grid feeling like a spreadsheet:
keyboard navigation, multi-cell selection, paste from and to Excel and Google Sheets, a
fill handle, nested and collapsible column headers. Building those by hand on a headless
table delays the first test of the hypothesis by a project or more.

Handsontable 18 has the whole set out of the box. Its license changed after the earlier
draft was written: the non-commercial license (v1.0, 2025-11-20) is perpetual for
non-commercial use (education, research, personal use, testing, demonstration) and
limits use in a commercial or institutional environment to a single, non-renewable
30-day evaluation. The 45 days the draft cited is a separate trial key issued by the
vendor.

linear.sesv.co is a public, non-monetised proof of concept published under MIT by an
individual, to demonstrate a proposal. It earns nothing and sells nothing.

## Decision

- The grid is Handsontable through its React wrapper, used under the non-commercial
  license key as a non-commercial, demonstrative project. This record is the written
  statement of that reading, dated.
- One module, the grid adapter, is the only importer of the grid library. It turns sheet
  state into grid configuration and grid events into intents. A build check fails when
  any other file imports the library (MIRROR-R22).
- The Handsontable formulas plugin is never used; formulas are evaluated in the document
  model (P4).
- The exit is a custom grid on TanStack Table with TanStack Virtual and shadcn, reached
  by writing a new adapter and theme. The document model, sync, auth and every other
  screen are unaffected.

## Alternatives considered

- Custom grid on TanStack Table from the start. No license question and Tailwind-native,
  but editing, selection, clipboard, fill and nested headers would be built by hand
  before the hypothesis could be tried.
- TanStack Table for the read-only P1 only, deciding at P2. Cheapest P1, but a likely
  throwaway and a second adapter within weeks.
- AG Grid Community. Lacks column groups with collapse and the clipboard and fill
  features in the free tier.
- Glide Data Grid, Univer. Canvas-based or whole-spreadsheet engines; heavier to adapt
  and further from the id-addressed document model.

## Consequences

- If the project's nature changes (a company adopts it, it is sold or monetised), the
  grid must be licensed commercially or replaced through the adapter before that
  happens. The 30-day evaluation clause is not a path for that case.
- The license key string in the code is the vendor's non-commercial key, not a trial.
- The adapter boundary is a hard rule enforced in CI, not a convention.
- HyperFormula, the vendor's formula engine, is GPLv3 and is not used; the repository
  stays MIT (REC-003). P4 records the evaluator decision.
