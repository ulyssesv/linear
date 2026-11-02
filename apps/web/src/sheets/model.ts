// The sheet model (MIRROR-R19): what a sheet shows, independent of the grid that renders
// it. Builders (projects.ts, initiatives.ts) turn mirror records into this shape; the grid
// adapter (grid/handsontable-adapter.tsx) turns it into grid configuration. Plain data
// only, so the server can return it from a server function and P2 can stage edits
// against the same column ids.

/** How a cell renders in P1 and which editor P2 attaches (spec MIRROR, section 4). */
export type CellShape =
  | "text"
  | "badge"
  | "user"
  | "date"
  | "chips"
  | "percent"
  | "excerpt"
  | "link"
  | "number";

/** A coloured label: a status, a priority, a label of a group, a team. */
export type Chip = { label: string; color: string | null };

export type UserValue = { name: string };
export type ExcerptValue = { text: string; date: string };
export type LinkValue = { href: string; label: string };

/** The value each shape carries. Absent values are null; chips are an empty list. */
export type ShapeValues = {
  text: string | null;
  badge: Chip | null;
  user: UserValue | null;
  /** `YYYY-MM-DD` */
  date: string | null;
  chips: Chip[];
  /** A fraction from 0 to 1. */
  percent: number | null;
  excerpt: ExcerptValue | null;
  link: LinkValue | null;
  number: number | null;
};

export type CellValue = ShapeValues[CellShape];

export type SheetColumn = {
  /** Stable across loads: a field name, or `label:<group id>` for a label group. */
  id: string;
  title: string;
  shape: CellShape;
};

/** Why a row is shown muted and only on request (MIRROR-R18). */
export type RowFlag = "archived" | "removed";

export type SheetRow = {
  /** The Linear id of the entity. */
  id: string;
  /** Empty for a live entity. */
  flags: RowFlag[];
  cells: Record<string, CellValue>;
};

export type SheetKind = "projects" | "initiatives";

export type SheetModel = {
  kind: SheetKind;
  columns: SheetColumn[];
  rows: SheetRow[];
};

/** Rows to show: live ones, plus flagged ones when asked (MIRROR-R18). */
export function visibleRows(rows: readonly SheetRow[], includeFlagged: boolean): SheetRow[] {
  return includeFlagged ? [...rows] : rows.filter((row) => row.flags.length === 0);
}

const flagLabels: Record<RowFlag, string> = { archived: "Archived", removed: "Removed" };

export function flagLabel(flag: RowFlag): string {
  return flagLabels[flag];
}

/** `2026-11-02` as `Nov 2, 2026`, in UTC so server and browser agree. */
export function formatDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * The plain text of a cell: what copy puts on the clipboard, and what a later sort or
 * filter can compare. Every shape has one.
 */
export function cellText(shape: CellShape, value: CellValue): string {
  if (value === null || value === undefined) return "";
  switch (shape) {
    case "text":
      return String(value);
    case "badge":
      return (value as Chip).label;
    case "user":
      return (value as UserValue).name;
    case "date":
      return formatDate(value as string);
    case "chips":
      return (value as Chip[]).map((chip) => chip.label).join(", ");
    case "percent":
      return formatPercent(value as number);
    case "excerpt": {
      const excerpt = value as ExcerptValue;
      return `${formatDate(excerpt.date)}: ${excerpt.text}`;
    }
    case "link":
      return (value as LinkValue).href;
    case "number":
      return String(value);
  }
}

/** Linear's priority scale. */
export const priorityLabels: Readonly<Record<number, string>> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

export function priorityBadge(priority: number): Chip {
  return { label: priorityLabels[priority] ?? "No priority", color: null };
}

/** Linear's health values, with the colours Linear shows them in. */
const healths: Record<string, Chip> = {
  onTrack: { label: "On track", color: "#4cb782" },
  atRisk: { label: "At risk", color: "#f2c94c" },
  offTrack: { label: "Off track", color: "#eb5757" },
};

export function healthBadge(health: string | null): Chip | null {
  if (!health) return null;
  return healths[health] ?? { label: health, color: null };
}

/** Only https links reach the page, so a mirrored value can never become a script URL. */
export function safeLink(url: string, label: string): LinkValue | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? { href: parsed.href, label } : null;
  } catch {
    return null;
  }
}
