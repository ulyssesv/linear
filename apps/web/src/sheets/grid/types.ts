// The boundary between a sheet and the grid that renders it (REC-004, MIRROR-R22). Nothing
// here names the grid library: pages depend on these types, and the adapter module is the
// only code that knows which grid is behind them. Replacing the grid means a new adapter
// that honours GridProps, and a new theme.
import type { SheetColumn, SheetRow } from "../model.ts";

/**
 * What the user asked the grid for, in terms of the sheet's column ids. P1 intents are
 * view-only and persist nothing; P2 adds edit, paste and fill intents to this union.
 */
export type GridIntent =
  | { type: "sort"; columnId: string; direction: "asc" | "desc" | null }
  | { type: "filter"; columnId: string; values: readonly string[] | null }
  | { type: "hide"; columnId: string; hidden: boolean }
  | { type: "resize"; columnId: string; width: number }
  /** The full column order after a move, by id. */
  | { type: "reorder"; columnIds: readonly string[] };

/** The sort the sheet applied, which the grid shows on the column's header. */
export type GridSort = { columnId: string; direction: "asc" | "desc" };

export type GridProps = {
  /** Accessible name of the grid, e.g. "Projects". */
  label: string;
  columns: readonly SheetColumn[];
  /**
   * The rows to show, in order. The sheet sorts and filters them; the grid never reorders
   * rows itself, it only reports a header click as a sort intent.
   */
  rows: readonly SheetRow[];
  /** Shown as the sort indicator; the rows are already in this order. */
  sort?: GridSort | null;
  /** Column ids not drawn. The grid keeps their width and position for when they return. */
  hiddenColumnIds?: readonly string[];
  onIntent?: (intent: GridIntent) => void;
};
