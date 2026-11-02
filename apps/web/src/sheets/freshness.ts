// Freshness of an open sheet (MIRROR-R24). P1 has no Electric (spec MIRROR, section 5), so
// the page polls a cheap marker of the mirror and, when it moved, receives either the rows
// that changed or, when that is not enough, the whole sheet again. P3 replaces this
// channel with Electric shapes.
//
// What the server sends (server/sheets/load.ts decides):
// - nothing, when neither the mirror's version nor its latest bulk run moved;
// - the rebuilt rows of the sheet's own entities written since the client's version, when
//   only those changed: updated rows replace theirs by id, new rows join, removed and
//   archived ones keep their place with their flags;
// - the whole sheet, when anything else changed: reference data (a renamed team, a
//   status, a label group, a user, for projects an initiative, for initiatives a project)
//   can touch any row and the columns, and a bootstrap or reconcile run may commit rows
//   below a version the client already saw.
//
// Webhook transactions can also commit out of order: one takes sequence 10, another 11,
// and 11 commits first. A client that moved its marker to 11 would never hear of 10, since
// the mirror's version stays 11. So the page asks for changes since the newest marker it
// observed at least `settleMs` ago, not since the latest one; a webhook transaction is
// capped at five seconds (server/webhooks/receive.ts), so by then every lower sequence has
// committed or rolled back. Rows already merged come again for a few polls; merging by id
// makes that harmless.
import type { SheetKind, SheetModel, SheetRow } from "./model.ts";

/** The mirror's change marker, as of a read: see MirrorFreshness on the server. */
export type SheetFreshness = {
  version: number;
  bulkRun: number;
  lastChangeAt: string | null;
};

/** A sheet as the page receives it: the model and the marker read before it. */
export type SheetView = { model: SheetModel; freshness: SheetFreshness };

export type SheetChange = { type: "rows"; rows: SheetRow[] } | { type: "full"; model: SheetModel };

export type SheetChanges =
  | { signedIn: false }
  | { signedIn: true; freshness: SheetFreshness; change: SheetChange | null };

/** What the page asks: changes to a sheet since the marker it holds. */
export type SheetChangesInput = { kind: SheetKind; version: number; bulkRun: number };

/** How long a version must have been seen before the page stops asking for what is below it. */
export const settleMs = 10_000;

/** Markers the page has observed, oldest first, each with when it was first seen. */
export type MarkerHistory = readonly { at: number; freshness: SheetFreshness }[];

/** The newest marker seen at least `settleMs` before `now`, or the oldest kept. */
function settled(history: MarkerHistory, now: number) {
  let base = history[0];
  for (const entry of history) if (entry.at <= now - settleMs) base = entry;
  return base;
}

/** Records a marker the server answered with; keeps only what `markerInput` may still use. */
export function observeMarker(
  history: MarkerHistory,
  freshness: SheetFreshness,
  now: number,
): MarkerHistory {
  const last = history.at(-1)?.freshness;
  const next =
    last && last.version === freshness.version && last.bulkRun === freshness.bulkRun
      ? [...history]
      : [...history, { at: now, freshness }];
  const base = settled(next, now);
  return base ? next.slice(next.indexOf(base)) : next;
}

/** The marker to send: the settled version, and the latest bulk run. */
export function markerInput(
  kind: SheetKind,
  history: MarkerHistory,
  now: number,
): SheetChangesInput {
  const base = settled(history, now);
  const latest = history.at(-1);
  return {
    kind,
    version: base?.freshness.version ?? 0,
    bulkRun: latest?.freshness.bulkRun ?? 0,
  };
}

const kinds: readonly SheetKind[] = ["projects", "initiatives"];

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("expected a non-negative integer");
  }
  return value;
}

/** Validates the poll's input, which arrives from the browser. */
export function parseSheetChangesInput(input: unknown): SheetChangesInput {
  const value = (input ?? {}) as Record<string, unknown>;
  const kind = kinds.find((k) => k === value.kind);
  if (!kind) throw new Error("unknown sheet");
  return { kind, version: count(value.version), bulkRun: count(value.bulkRun) };
}

/** The sheet after a change: rows merged by id, or the whole sheet replaced. */
export function applyChange(model: SheetModel, change: SheetChange | null): SheetModel {
  if (!change) return model;
  if (change.type === "full") return change.model;
  if (change.rows.length === 0) return model;
  const changed = new Map(change.rows.map((row) => [row.id, row]));
  const rows = model.rows.map((row) => {
    const next = changed.get(row.id);
    if (!next) return row;
    changed.delete(row.id);
    return next;
  });
  rows.push(...changed.values());
  return { ...model, rows };
}

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** `just now`, `2 minutes ago`, `yesterday`: how long before `now` a time was. */
export function relativeTime(at: string, now: number): string {
  const seconds = Math.round((now - Date.parse(at)) / 1000);
  if (!Number.isFinite(seconds)) return at;
  if (seconds < 45) return "just now";
  for (const [unit, size] of units) {
    if (seconds >= size) return relative.format(-Math.floor(seconds / size), unit);
  }
  return relative.format(-Math.max(1, Math.round(seconds / 60)), "minute");
}

/** `Nov 2, 2026, 14:03:05 UTC`-style absolute time in the viewer's zone, for a tooltip. */
export function absoluteTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "long",
  });
}
