import { describe, expect, it } from "vitest";
import { type HeaderSortConfig, sortIntent } from "../src/sheets/grid/sort-intent.ts";

const ids = ["name", "status", "targetDate"];
const columnIdAt = (visual: number) => ids[visual];

const config = (column: number, sortOrder: HeaderSortConfig["sortOrder"]): HeaderSortConfig[] => [
  { column, sortOrder },
];

describe("a header click as a sort intent", () => {
  it("MIRROR-R20 sorts ascending, then descending, by the clicked column's id", () => {
    expect(sortIntent([], config(1, "asc"), columnIdAt)).toEqual({
      type: "sort",
      columnId: "status",
      direction: "asc",
    });
    expect(sortIntent(config(1, "asc"), config(1, "desc"), columnIdAt)).toEqual({
      type: "sort",
      columnId: "status",
      direction: "desc",
    });
  });

  it("MIRROR-R20 clears the sort of the column it leaves, with no destination or with none", () => {
    const cleared = { type: "sort", columnId: "targetDate", direction: null };
    expect(sortIntent(config(2, "desc"), [], columnIdAt)).toEqual(cleared);
    expect(sortIntent(config(2, "desc"), config(2, "none"), columnIdAt)).toEqual(cleared);
  });

  it("MIRROR-R20 asks for nothing when no column is involved or the column is unknown", () => {
    expect(sortIntent([], [], columnIdAt)).toBeNull();
    expect(sortIntent([], config(7, "asc"), columnIdAt)).toBeNull();
  });
});
