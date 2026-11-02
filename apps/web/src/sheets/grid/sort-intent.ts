// A header click as a sort intent (MIRROR-R20). Kept apart from the adapter so it can be
// tested without the grid library, which only the adapter may import (MIRROR-R22).
import type { GridIntent } from "./types.ts";

/**
 * One column's sort as the grid's header plugin reports it, by visual column. Handsontable
 * declares `none` alongside `asc` and `desc`; it means the column is no longer sorted.
 */
export type HeaderSortConfig = { column: number; sortOrder: "asc" | "desc" | "none" };

/**
 * The intent for a change of header sort from `current` to `destination`: the destination's
 * column and order, or, when there is none or its order is `none`, clearing the sort of the
 * column it leaves. Null when no known column is involved.
 */
export function sortIntent(
  current: readonly HeaderSortConfig[],
  destination: readonly HeaderSortConfig[],
  columnIdAt: (visual: number) => string | undefined,
): Extract<GridIntent, { type: "sort" }> | null {
  const next = destination[0];
  const target = next ?? current[0];
  const columnId = target ? columnIdAt(target.column) : undefined;
  if (!columnId) return null;
  const direction = next && next.sortOrder !== "none" ? next.sortOrder : null;
  return { type: "sort", columnId, direction };
}
