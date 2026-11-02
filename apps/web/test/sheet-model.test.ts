// The sheet model builders (MIRROR-R18, MIRROR-R19): mirror records in, the columns of
// spec MIRROR section 4 and one row per entity out. Pure; no database, no grid.
import { describe, expect, it } from "vitest";
import type {
  Initiative,
  InitiativeLabel,
  Mirrored,
  Project,
  ProjectLabel,
  ProjectStatus,
  Team,
  User,
} from "../src/server/mirror/types.ts";
import { buildInitiativesSheet } from "../src/sheets/initiatives.ts";
import { cellText, type SheetModel, safeLink, visibleRows } from "../src/sheets/model.ts";
import { buildProjectsSheet } from "../src/sheets/projects.ts";

const at = "2026-10-01T00:00:00.000Z";

function mirrored<T extends { id: string }>(
  record: Omit<T, "updatedAt" | "archivedAt"> & Partial<T>,
  removedAt: string | null = null,
): Mirrored<T> {
  return {
    updatedAt: at,
    archivedAt: null,
    ...record,
    removedAt,
    syncedAt: at,
    syncedSource: "bootstrap",
    syncSeq: 1,
  } as unknown as Mirrored<T>;
}

const team = (id: string, name: string, removed = false) =>
  mirrored<Team>(
    { id, name, key: name.toUpperCase(), displayName: name, parentId: null, private: false },
    removed ? at : null,
  );
const user = (id: string, name: string) =>
  mirrored<User>({
    id,
    name,
    displayName: name.toLowerCase(),
    email: `${id}@example.com`,
    avatarUrl: null,
    active: true,
  });

function label<T extends ProjectLabel | InitiativeLabel>(
  id: string,
  name: string,
  options: Partial<ProjectLabel> = {},
) {
  return mirrored<T>({
    id,
    name,
    color: "#5e6ad2",
    isGroup: false,
    selection: null,
    parentId: null,
    teamId: null,
    ...options,
  } as unknown as T);
}

function project(id: string, options: Partial<Project> = {}, removedAt: string | null = null) {
  return mirrored<Project>(
    {
      id,
      name: `Project ${id}`,
      slugId: `${id}-slug`,
      identifier: null,
      url: `https://linear.app/sesv/project/${id}-slug`,
      statusId: "status-started",
      leadId: "user-ana",
      startDate: "2026-10-01",
      targetDate: "2026-12-31",
      priority: 2,
      health: "atRisk",
      progress: 0.256,
      teamIds: ["team-a", "team-b"],
      initiativeIds: [],
      labelIds: [],
      lastUpdate: {
        id: "pu-1",
        excerpt: "Shipped the first milestone.",
        health: "onTrack",
        createdAt: "2026-10-20T09:30:00.000Z",
      },
      createdAt: at,
      completedAt: null,
      canceledAt: null,
      ...options,
    },
    removedAt,
  );
}

function initiative(
  id: string,
  options: Partial<Initiative> = {},
  removedAt: string | null = null,
) {
  return mirrored<Initiative>(
    {
      id,
      name: `Initiative ${id}`,
      slugId: `${id}-slug`,
      identifier: `I-${id}`,
      url: `https://linear.app/sesv/initiative/${id}-slug`,
      status: "Active",
      ownerId: "user-ben",
      leadTeamId: "team-a",
      targetDate: "2027-03-31",
      priority: 1,
      health: "onTrack",
      projectIds: [],
      labelIds: [],
      lastUpdate: null,
      createdAt: at,
      completedAt: null,
      ...options,
    },
    removedAt,
  );
}

const statuses = [
  mirrored<ProjectStatus>({
    id: "status-started",
    name: "In Progress",
    type: "started",
    color: "#f2c94c",
    position: 1,
  }),
];
const teams = [team("team-a", "Alpha"), team("team-b", "Beta"), team("team-gone", "Gone", true)];
const users = [user("user-ana", "Ana"), user("user-ben", "Ben")];

const projectLabels = [
  label<ProjectLabel>("g-size", "Size", { isGroup: true, selection: "single" }),
  label<ProjectLabel>("g-size-s", "S", { parentId: "g-size", color: "#4cb782" }),
  label<ProjectLabel>("g-size-l", "L", { parentId: "g-size" }),
  label<ProjectLabel>("g-theme", "Theme", { isGroup: true, selection: "multi" }),
  label<ProjectLabel>("g-theme-x", "Growth", { parentId: "g-theme" }),
  label<ProjectLabel>("g-risk-a", "Risk", { isGroup: true, selection: "single", teamId: "team-a" }),
  label<ProjectLabel>("g-risk-b", "Risk", { isGroup: true, selection: "single", teamId: "team-b" }),
  label<ProjectLabel>("g-risk-a-high", "High", { parentId: "g-risk-a" }),
  label<ProjectLabel>("g-old", "Old", { isGroup: true, selection: "single", archivedAt: at }),
  label<ProjectLabel>("bet", "Bet"),
];

const titles = (model: SheetModel) => model.columns.map((column) => column.title);
const shapes = (model: SheetModel) =>
  Object.fromEntries(model.columns.map((column) => [column.title, column.shape]));

describe("projects sheet", () => {
  const initiatives = [initiative("i1"), initiative("i-gone", {}, at)];
  const model = buildProjectsSheet({
    projects: [
      project("p1", {
        identifier: "TST-1",
        labelIds: ["g-size-s", "g-theme-x", "g-risk-a-high", "bet"],
        initiativeIds: ["i1", "i-gone", "i-private"],
        teamIds: ["team-a", "team-b", "team-gone"],
      }),
      project("p2", { archivedAt: at, leadId: null, statusId: null, lastUpdate: null }),
      project("p3", {}, at),
    ],
    projectStatuses: statuses,
    users,
    teams,
    projectLabels,
    initiatives,
  });

  it("MIRROR-R19 has the columns of section 4 in order, with their shapes", () => {
    expect(titles(model)).toEqual([
      "Name",
      "Status",
      "Lead",
      "Start date",
      "Target date",
      "Priority",
      "Risk (Alpha)",
      "Risk (Beta)",
      "Size",
      "Teams",
      "Initiatives",
      "Health",
      "Progress",
      "Latest update",
      "Link",
    ]);
    expect(shapes(model)).toEqual({
      Name: "text",
      Status: "badge",
      Lead: "user",
      "Start date": "date",
      "Target date": "date",
      Priority: "badge",
      "Risk (Alpha)": "badge",
      "Risk (Beta)": "badge",
      Size: "badge",
      Teams: "chips",
      Initiatives: "chips",
      Health: "badge",
      Progress: "percent",
      "Latest update": "excerpt",
      Link: "link",
    });
    expect(model.kind).toBe("projects");
  });

  it("MIRROR-R19 resolves every linked value of a project through the mirror", () => {
    const row = model.rows.find((r) => r.id === "p1");
    expect(row?.flags).toEqual([]);
    expect(row?.cells).toEqual({
      name: "Project p1",
      status: { label: "In Progress", color: "#f2c94c" },
      lead: { name: "Ana" },
      startDate: "2026-10-01",
      targetDate: "2026-12-31",
      priority: { label: "High", color: null },
      "label:g-risk-a": { label: "High", color: "#5e6ad2" },
      "label:g-risk-b": null,
      "label:g-size": { label: "S", color: "#4cb782" },
      // Removed teams and initiatives, and ids the mirror never held, are left out.
      teams: [
        { label: "Alpha", color: null },
        { label: "Beta", color: null },
      ],
      initiatives: [{ label: "Initiative i1", color: null }],
      health: { label: "At risk", color: "#f2c94c" },
      progress: 0.256,
      latestUpdate: { text: "Shipped the first milestone.", date: "2026-10-20T09:30:00.000Z" },
      link: { href: "https://linear.app/sesv/project/p1-slug", label: "TST-1" },
    });
  });

  it("MIRROR-R19 leaves absent values empty and labels a link by its slug without an identifier", () => {
    const row = model.rows.find((r) => r.id === "p2");
    expect(row?.cells.lead).toBeNull();
    expect(row?.cells.status).toBeNull();
    expect(row?.cells.latestUpdate).toBeNull();
    expect(row?.cells.link).toEqual({
      href: "https://linear.app/sesv/project/p2-slug",
      label: "p2-slug",
    });
  });

  it("MIRROR-R18 lists every project, flagging archived and removed ones", () => {
    expect(model.rows.map((r) => [r.id, r.flags])).toEqual([
      ["p1", []],
      ["p2", ["archived"]],
      ["p3", ["removed"]],
    ]);
    expect(visibleRows(model.rows, false).map((r) => r.id)).toEqual(["p1"]);
    expect(visibleRows(model.rows, true).map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
  });
});

describe("initiatives sheet", () => {
  const initiativeLabels = [
    label<InitiativeLabel>("h", "Horizon", { isGroup: true, selection: "single" }),
    label<InitiativeLabel>("h1", "H1", { parentId: "h" }),
    label<InitiativeLabel>("pillar", "Pillar"),
  ];
  const model = buildInitiativesSheet({
    initiatives: [
      initiative("i1", {
        labelIds: ["h1", "pillar"],
        projectIds: ["p1", "p2", "p-removed", "p-private"],
        lastUpdate: {
          id: "iu-1",
          excerpt: "On track.",
          health: "onTrack",
          createdAt: "2026-10-21T00:00:00.000Z",
        },
      }),
      initiative("i2", { archivedAt: at, ownerId: null, leadTeamId: null, identifier: null }),
      initiative("i3", {}, at),
    ],
    users,
    teams,
    initiativeLabels,
    projects: [project("p1"), project("p2", { archivedAt: at }), project("p-removed", {}, at)],
  });

  it("MIRROR-R19 has the columns of section 4 in order, with their shapes", () => {
    expect(shapes(model)).toEqual({
      Name: "text",
      Status: "badge",
      Owner: "user",
      "Target date": "date",
      Priority: "badge",
      Horizon: "badge",
      "Lead team": "chips",
      Health: "badge",
      Projects: "number",
      "Latest update": "excerpt",
      Link: "link",
    });
    expect(titles(model)[0]).toBe("Name");
    expect(titles(model).at(-1)).toBe("Link");
    expect(model.kind).toBe("initiatives");
  });

  it("MIRROR-R19 resolves every linked value and counts the initiative's mirrored projects", () => {
    const row = model.rows.find((r) => r.id === "i1");
    expect(row?.cells).toEqual({
      name: "Initiative i1",
      status: { label: "Active", color: null },
      owner: { name: "Ben" },
      targetDate: "2027-03-31",
      priority: { label: "Urgent", color: null },
      "label:h": { label: "H1", color: "#5e6ad2" },
      leadTeam: [{ label: "Alpha", color: null }],
      health: { label: "On track", color: "#4cb782" },
      // p1 and the archived p2; the removed project and the one never mirrored do not count.
      projects: 2,
      latestUpdate: { text: "On track.", date: "2026-10-21T00:00:00.000Z" },
      link: { href: "https://linear.app/sesv/initiative/i1-slug", label: "I-i1" },
    });
    const bare = model.rows.find((r) => r.id === "i2");
    expect(bare?.cells.owner).toBeNull();
    expect(bare?.cells.leadTeam).toEqual([]);
    expect(bare?.cells.link).toEqual({
      href: "https://linear.app/sesv/initiative/i2-slug",
      label: "i2-slug",
    });
  });

  it("MIRROR-R18 lists every initiative, flagging archived and removed ones", () => {
    expect(model.rows.map((r) => [r.id, r.flags])).toEqual([
      ["i1", []],
      ["i2", ["archived"]],
      ["i3", ["removed"]],
    ]);
  });
});

describe("cell text", () => {
  it("MIRROR-R19 gives every shape a plain text for copy", () => {
    expect(cellText("text", "Plan")).toBe("Plan");
    expect(cellText("badge", { label: "High", color: null })).toBe("High");
    expect(cellText("user", { name: "Ana" })).toBe("Ana");
    expect(cellText("date", "2026-12-31")).toBe("Dec 31, 2026");
    expect(
      cellText("chips", [
        { label: "Alpha", color: null },
        { label: "Beta", color: null },
      ]),
    ).toBe("Alpha, Beta");
    expect(cellText("percent", 0.256)).toBe("26%");
    expect(cellText("excerpt", { text: "Done.", date: "2026-10-20T23:30:00.000Z" })).toBe(
      "Oct 20, 2026: Done.",
    );
    expect(cellText("link", { href: "https://linear.app/x", label: "X-1" })).toBe(
      "https://linear.app/x",
    );
    expect(cellText("number", 3)).toBe("3");
    expect(cellText("badge", null)).toBe("");
  });

  it("MIRROR-R19 lets only https links through", () => {
    expect(safeLink("https://linear.app/sesv/project/x", "X")).toEqual({
      href: "https://linear.app/sesv/project/x",
      label: "X",
    });
    expect(safeLink("javascript:alert(1)", "X")).toBeNull();
    expect(safeLink("http://linear.app/x", "X")).toBeNull();
    expect(safeLink("not a url", "X")).toBeNull();
  });
});
