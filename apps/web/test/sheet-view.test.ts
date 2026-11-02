// View-level sort, filter and column hide (MIRROR-R20), on the sheet model. The browser
// behaviour, including that nothing persists or is written, is covered end to end in
// e2e/sheet-behaviours.spec.ts.
import { describe, expect, it } from "vitest";
import {
  type CellValue,
  priorityBadge,
  type SheetColumn,
  type SheetRow,
} from "../src/sheets/model.ts";
import {
  filterOptions,
  filterRows,
  sortRows,
  toggleHidden,
  toggleValue,
} from "../src/sheets/view.ts";

const columns: SheetColumn[] = [
  { id: "name", title: "Name", shape: "text" },
  { id: "status", title: "Status", shape: "badge" },
  { id: "lead", title: "Lead", shape: "user" },
  { id: "targetDate", title: "Target date", shape: "date" },
  { id: "priority", title: "Priority", shape: "badge" },
  { id: "teams", title: "Teams", shape: "chips" },
  { id: "leadTeam", title: "Lead team", shape: "chips" },
  { id: "health", title: "Health", shape: "badge" },
  { id: "progress", title: "Progress", shape: "percent" },
  { id: "projects", title: "Projects", shape: "number" },
  { id: "latestUpdate", title: "Latest update", shape: "excerpt" },
  { id: "link", title: "Link", shape: "link" },
];

const chip = (label: string) => ({ label, color: null });

function row(id: string, cells: Record<string, CellValue>): SheetRow {
  return { id, flags: [], cells: { name: `Project ${id}`, ...cells } };
}

const ids = (rows: readonly SheetRow[]) => rows.map((r) => r.id);

describe("sorting rows", () => {
  it("MIRROR-R20 orders by name, then id, without a sort", () => {
    const rows = [
      row("b", { name: "beta" }),
      row("a2", { name: "Alpha" }),
      row("a1", { name: "alpha" }),
      row("c", { name: "Project 10" }),
      row("d", { name: "Project 9" }),
    ];
    expect(ids(sortRows(rows, columns, null))).toEqual(["a1", "a2", "b", "d", "c"]);
  });

  it("MIRROR-R20 sorts dates chronologically with empty dates last in both directions", () => {
    const rows = [
      row("none", { targetDate: null }),
      row("dec", { targetDate: "2026-12-31" }),
      row("feb", { targetDate: "2027-02-01" }),
      row("jan", { targetDate: "2026-01-15" }),
    ];
    const asc = sortRows(rows, columns, { columnId: "targetDate", direction: "asc" });
    expect(ids(asc)).toEqual(["jan", "dec", "feb", "none"]);
    const desc = sortRows(rows, columns, { columnId: "targetDate", direction: "desc" });
    expect(ids(desc)).toEqual(["feb", "dec", "jan", "none"]);
  });

  it("MIRROR-R20 sorts priority in Linear's order with no priority last", () => {
    const rows = [0, 4, 1, 3, 2].map((p) => row(`p${p}`, { priority: priorityBadge(p) }));
    const asc = sortRows(rows, columns, { columnId: "priority", direction: "asc" });
    expect(ids(asc)).toEqual(["p1", "p2", "p3", "p4", "p0"]);
    const desc = sortRows(rows, columns, { columnId: "priority", direction: "desc" });
    expect(ids(desc)).toEqual(["p4", "p3", "p2", "p1", "p0"]);
  });

  it("MIRROR-R20 sorts percentages and numbers numerically, not as text", () => {
    const rows = [
      row("nine", { progress: 0.09, projects: 9 }),
      row("hundred", { progress: 1, projects: 10 }),
      row("half", { progress: 0.5, projects: 2 }),
      row("empty", { progress: null, projects: null }),
    ];
    expect(ids(sortRows(rows, columns, { columnId: "progress", direction: "asc" }))).toEqual([
      "nine",
      "half",
      "hundred",
      "empty",
    ]);
    expect(ids(sortRows(rows, columns, { columnId: "projects", direction: "desc" }))).toEqual([
      "hundred",
      "nine",
      "half",
      "empty",
    ]);
  });

  it("MIRROR-R20 sorts text, users, badges, chips and links as words, empty last", () => {
    const rows = [
      row("z", { lead: { name: "zoe" }, status: chip("Planned"), teams: [chip("Ops")] }),
      row("a", { lead: { name: "Ana" }, status: chip("Backlog"), teams: [] }),
      row("n", { lead: null, status: null, teams: [chip("Core"), chip("Web")] }),
    ];
    expect(ids(sortRows(rows, columns, { columnId: "lead", direction: "asc" }))).toEqual([
      "a",
      "z",
      "n",
    ]);
    expect(ids(sortRows(rows, columns, { columnId: "status", direction: "desc" }))).toEqual([
      "z",
      "a",
      "n",
    ]);
    expect(ids(sortRows(rows, columns, { columnId: "teams", direction: "asc" }))).toEqual([
      "n",
      "z",
      "a",
    ]);
    const links = [
      row("p10", { link: { href: "https://linear.app/x", label: "P-10" } }),
      row("p9", { link: { href: "https://linear.app/y", label: "P-9" } }),
    ];
    expect(ids(sortRows(links, columns, { columnId: "link", direction: "asc" }))).toEqual([
      "p9",
      "p10",
    ]);
  });

  it("MIRROR-R20 sorts health from on track to off track and updates by date", () => {
    const rows = [
      row("off", { health: chip("Off track"), latestUpdate: { text: "a", date: "2026-10-03" } }),
      row("on", { health: chip("On track"), latestUpdate: { text: "z", date: "2026-10-01" } }),
      row("risk", { health: chip("At risk"), latestUpdate: null }),
    ];
    expect(ids(sortRows(rows, columns, { columnId: "health", direction: "asc" }))).toEqual([
      "on",
      "risk",
      "off",
    ]);
    expect(ids(sortRows(rows, columns, { columnId: "latestUpdate", direction: "desc" }))).toEqual([
      "off",
      "on",
      "risk",
    ]);
  });

  it("MIRROR-R20 breaks ties by name and ignores an unknown column", () => {
    const rows = [
      row("b", { name: "B", priority: priorityBadge(2) }),
      row("a", { name: "A", priority: priorityBadge(2) }),
    ];
    expect(ids(sortRows(rows, columns, { columnId: "priority", direction: "desc" }))).toEqual([
      "a",
      "b",
    ]);
    expect(ids(sortRows(rows, columns, { columnId: "gone", direction: "desc" }))).toEqual([
      "a",
      "b",
    ]);
  });

  it("MIRROR-R20 returns a new array and leaves the model alone", () => {
    const rows = [row("b", {}), row("a", {})];
    const sorted = sortRows(rows, columns, null);
    expect(sorted).not.toBe(rows);
    expect(ids(rows)).toEqual(["b", "a"]);
  });
});

describe("filtering rows", () => {
  const projects = [
    row("core", { teams: [chip("Core")], status: chip("Planned") }),
    row("both", { teams: [chip("Core"), chip("Web")], status: chip("Started") }),
    row("web", { teams: [chip("Web")], status: null }),
    row("ops", { teams: [chip("Ops")], status: chip("Started") }),
  ];

  it("MIRROR-R20 keeps every row with no selection", () => {
    expect(ids(filterRows(projects, "projects", { teams: [], statuses: [] }))).toEqual(
      ids(projects),
    );
  });

  it("MIRROR-R20 matches a project when any of its teams is selected", () => {
    expect(ids(filterRows(projects, "projects", { teams: ["Web"], statuses: [] }))).toEqual([
      "both",
      "web",
    ]);
    expect(ids(filterRows(projects, "projects", { teams: ["Ops", "Core"], statuses: [] }))).toEqual(
      ["core", "both", "ops"],
    );
  });

  it("MIRROR-R20 matches statuses, rows without one through None, and combines filters with AND", () => {
    expect(ids(filterRows(projects, "projects", { teams: [], statuses: ["Started"] }))).toEqual([
      "both",
      "ops",
    ]);
    expect(ids(filterRows(projects, "projects", { teams: [], statuses: [""] }))).toEqual(["web"]);
    expect(
      ids(filterRows(projects, "projects", { teams: ["Core"], statuses: ["Started"] })),
    ).toEqual(["both"]);
  });

  it("MIRROR-R20 matches an initiative by its lead team", () => {
    const initiatives = [
      row("i1", { leadTeam: [chip("Core")], teams: [chip("Web")] }),
      row("i2", { leadTeam: [] }),
    ];
    expect(ids(filterRows(initiatives, "initiatives", { teams: ["Core"], statuses: [] }))).toEqual([
      "i1",
    ]);
    expect(ids(filterRows(initiatives, "initiatives", { teams: ["Web"], statuses: [] }))).toEqual(
      [],
    );
    expect(ids(filterRows(initiatives, "initiatives", { teams: [""], statuses: [] }))).toEqual([
      "i2",
    ]);
  });

  it("MIRROR-R20 offers the values present, by name, with counts and None last", () => {
    expect(filterOptions(projects, "teams")).toEqual([
      { value: "Core", label: "Core", count: 2 },
      { value: "Ops", label: "Ops", count: 1 },
      { value: "Web", label: "Web", count: 2 },
    ]);
    expect(filterOptions(projects, "status", "No status")).toEqual([
      { value: "Planned", label: "Planned", count: 1 },
      { value: "Started", label: "Started", count: 2 },
      { value: "", label: "No status", count: 1 },
    ]);
  });

  it("MIRROR-R20 toggles a value in a selection", () => {
    expect(toggleValue(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a", false)).toEqual(["b"]);
    expect(toggleValue(["a"], "a", true)).toEqual(["a"]);
  });
});

describe("hiding columns", () => {
  it("MIRROR-R20 hides and shows a column, never the name", () => {
    const hidden = toggleHidden([], "lead", true);
    expect(hidden).toEqual(["lead"]);
    expect(toggleHidden(hidden, "lead", false)).toEqual([]);
    expect(toggleHidden(hidden, "name", true)).toEqual(["lead"]);
  });
});
