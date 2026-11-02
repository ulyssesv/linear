// View-level sheet behaviours (MIRROR-R20): sort, filter by team and by status, and column
// hide. Pure functions over the sheet model; the page keeps a SheetViewState in React
// state only, so a reload forgets it and nothing is ever written (spec MIRROR, section 2:
// a sheet filter that persists is P2).
//
// Rows are ordered here, not by the grid: the grid's own data is each cell's plain text,
// which would sort dates, priorities and percentages as strings. Ordering in the model also
// keeps the order independent of the grid library (REC-004).
import {
  type CellShape,
  type CellValue,
  type Chip,
  type ExcerptValue,
  type LinkValue,
  priorityLabels,
  type SheetColumn,
  type SheetKind,
  type SheetRow,
  type UserValue,
} from "./model.ts";

export type SortDirection = "asc" | "desc";
export type SheetSort = { columnId: string; direction: SortDirection };

/** A filter value: a team or status label, or `""` for rows without one. */
export type FilterValues = readonly string[];

export type SheetViewState = {
  sort: SheetSort | null;
  /** Selected teams; empty means every team. */
  teams: FilterValues;
  /** Selected statuses; empty means every status. */
  statuses: FilterValues;
  hidden: readonly string[];
};

export const initialViewState: SheetViewState = { sort: null, teams: [], statuses: [], hidden: [] };

/** The column a sheet filters teams by: a project's teams, an initiative's lead team. */
export const teamColumn: Record<SheetKind, string> = { projects: "teams", initiatives: "leadTeam" };
export const statusColumn = "status";
/** The first column, frozen, and never hidden. */
export const nameColumn = "name";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function compareText(a: string, b: string): number {
  return collator.compare(a, b);
}

const priorityRank = new Map<string, number>(
  // Linear's order: Urgent, High, Medium, Low, then No priority last.
  [1, 2, 3, 4, 0].map((priority, rank) => [priorityLabels[priority] ?? "", rank]),
);

const healthRank = new Map<string, number>([
  ["On track", 0],
  ["At risk", 1],
  ["Off track", 2],
]);

/** A comparable key, or null for an empty cell; empty cells sort last in both directions. */
type SortKey = string | number | null;

function sortKey(column: SheetColumn, value: CellValue): SortKey {
  if (value === null || value === undefined) return null;
  switch (column.shape satisfies CellShape) {
    case "text":
      return String(value) || null;
    case "badge": {
      const label = (value as Chip).label;
      if (column.id === "priority") {
        // "No priority" is a value in Linear but sorts last, like an empty cell.
        const rank = priorityRank.get(label);
        return rank === undefined || rank === 4 ? null : rank;
      }
      if (column.id === "health") return healthRank.get(label) ?? label;
      return label;
    }
    case "user":
      return (value as UserValue).name;
    case "date":
      return value as string;
    case "chips": {
      const labels = (value as Chip[]).map((chip) => chip.label);
      return labels.length > 0 ? labels.join(", ") : null;
    }
    case "percent":
    case "number":
      return value as number;
    case "excerpt":
      // Latest updates sort by when they were posted.
      return (value as ExcerptValue).date;
    case "link":
      return (value as LinkValue).label;
  }
}

function compareKeys(a: SortKey, b: SortKey): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  // ISO dates compare correctly as plain strings; everything else as words.
  return compareText(String(a), String(b));
}

/** Name, then id: the default order and every sort's tie-break, so order is stable. */
function compareDefault(a: SheetRow, b: SheetRow): number {
  const byName = compareText(String(a.cells[nameColumn] ?? ""), String(b.cells[nameColumn] ?? ""));
  return byName || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Rows in view order: by the sort column, empty cells last in either direction, ties by
 * name and id; without a sort, by name. Returns a new array.
 */
export function sortRows(
  rows: readonly SheetRow[],
  columns: readonly SheetColumn[],
  sort: SheetSort | null,
): SheetRow[] {
  const column = sort ? columns.find((c) => c.id === sort.columnId) : undefined;
  if (!sort || !column) return [...rows].sort(compareDefault);
  const sign = sort.direction === "asc" ? 1 : -1;
  const keyed = rows.map((row) => ({ row, key: sortKey(column, row.cells[column.id] ?? null) }));
  keyed.sort((a, b) => {
    if (a.key === null || b.key === null) {
      if (a.key === b.key) return compareDefault(a.row, b.row);
      return a.key === null ? 1 : -1;
    }
    return sign * compareKeys(a.key, b.key) || compareDefault(a.row, b.row);
  });
  return keyed.map((item) => item.row);
}

/** The labels a cell offers a filter: chip labels, a badge's label, or `""` when empty. */
function filterLabels(value: CellValue): string[] {
  if (value === null || value === undefined) return [""];
  if (Array.isArray(value)) return value.length > 0 ? value.map((chip) => chip.label) : [""];
  if (typeof value === "object" && "label" in value) return [(value as Chip).label];
  return [String(value)];
}

export type FilterOption = { value: string; label: string; count: number };

/**
 * The values a filter offers, from the given rows: every label present, by name, then
 * "None" when some row has no value. Counts are rows per value.
 */
export function filterOptions(
  rows: readonly SheetRow[],
  columnId: string,
  noneLabel = "None",
): FilterOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const label of new Set(filterLabels(row.cells[columnId] ?? null))) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  const options = [...counts]
    .filter(([value]) => value !== "")
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => compareText(a.label, b.label));
  const none = counts.get("");
  if (none) options.push({ value: "", label: noneLabel, count: none });
  return options;
}

/** Whether a row passes one filter: no selection, or any of its labels selected. */
function passes(row: SheetRow, columnId: string, selected: FilterValues): boolean {
  if (selected.length === 0) return true;
  return filterLabels(row.cells[columnId] ?? null).some((label) => selected.includes(label));
}

/**
 * Rows that pass every filter: a project matches a team when any of its teams is
 * selected, an initiative when its lead team is; a row matches a status when its status
 * is selected. Filters combine with AND, values within a filter with OR.
 */
export function filterRows(
  rows: readonly SheetRow[],
  kind: SheetKind,
  view: Pick<SheetViewState, "teams" | "statuses">,
): SheetRow[] {
  return rows.filter(
    (row) => passes(row, teamColumn[kind], view.teams) && passes(row, statusColumn, view.statuses),
  );
}

/** Toggles a column's hidden state; the name column is never hidden. */
export function toggleHidden(
  hidden: readonly string[],
  columnId: string,
  hide: boolean,
): readonly string[] {
  if (columnId === nameColumn) return hidden;
  const without = hidden.filter((id) => id !== columnId);
  return hide ? [...without, columnId] : without;
}

/** Toggles a value in a filter selection. */
export function toggleValue(selected: FilterValues, value: string, on: boolean): FilterValues {
  const without = selected.filter((v) => v !== value);
  return on ? [...without, value] : without;
}
