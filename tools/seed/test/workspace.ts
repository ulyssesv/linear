// A small workspace shaped like the real one: `Test` with three public sub-teams and one
// private one, the working team `LIN`, the private team `SBX`, and entities outside the
// hierarchy that collide with fixture names or even carry the fixture marker.
import { descriptionFor } from "../src/fixtures.ts";
import type { Initiative, Label, Project, Workspace } from "../src/model.ts";

export const T = {
  root: "team-test",
  tam: "team-tam",
  tmg: "team-tmg",
  tmb: "team-tmb",
  private: "team-tpv",
  lin: "team-lin",
  sbx: "team-sbx",
};

export function project(over: Partial<Project> & Pick<Project, "id">): Project {
  return {
    name: "A project",
    description: "",
    statusId: "status-backlog",
    leadId: null,
    leadTeamId: null,
    teamIds: [T.lin],
    startDate: null,
    targetDate: null,
    priority: 0,
    labelIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    trashed: false,
    ...over,
  };
}

export function initiative(over: Partial<Initiative> & Pick<Initiative, "id">): Initiative {
  return {
    name: "An initiative",
    description: null,
    status: "Planned",
    ownerId: null,
    leadTeamId: null,
    targetDate: null,
    priority: 0,
    labelIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    trashed: false,
    ...over,
  };
}

export function label(over: Partial<Label> & Pick<Label, "id" | "name">): Label {
  return {
    isGroup: false,
    groupType: null,
    parentId: null,
    teamId: null,
    color: "#000000",
    description: null,
    retiredAt: null,
    ...over,
  };
}

/** Projects and initiatives outside the hierarchy that the tool must never touch. */
export const OUTSIDERS = {
  linCollidingName: "proj-lin-name",
  linMarked: "proj-lin-marked",
  sbxMarked: "proj-sbx-marked",
  mixedMarked: "proj-mixed-marked",
  realInitiative: "init-real",
  linLedMarkedInitiative: "init-lin-marked",
  realProjectGroup: "plabel-area",
  realProjectChild: "plabel-area-web",
  realInitiativeLabel: "ilabel-strategic",
};

export function workspace(): Workspace {
  return {
    teams: [
      { id: T.root, key: "TST", name: "Test", private: false, parentId: null },
      { id: T.tmg, key: "TMG", name: "Test Mgmt", private: false, parentId: T.root },
      { id: T.tam, key: "TAM", name: "Test Alpha", private: false, parentId: T.root },
      { id: T.tmb, key: "TMB", name: "Test Mobile", private: false, parentId: T.root },
      { id: T.private, key: "TPV", name: "Test Private", private: true, parentId: T.root },
      { id: T.lin, key: "LIN", name: "Linear", private: false, parentId: null },
      { id: T.sbx, key: "SBX", name: "Sandbox", private: true, parentId: null },
    ],
    users: [
      { id: "u-cy", name: "Cy", email: "cy@example.com", active: true, guest: false, app: false },
      { id: "u-al", name: "Al", email: "al@example.com", active: true, guest: false, app: false },
      { id: "u-bo", name: "Bo", email: "bo@example.com", active: true, guest: false, app: false },
      { id: "u-gu", name: "Gu", email: "gu@example.com", active: true, guest: true, app: false },
      { id: "u-ap", name: "Ap", email: "ap@example.com", active: true, guest: false, app: true },
      { id: "u-ex", name: "Ex", email: "ex@example.com", active: false, guest: false, app: false },
    ],
    projectStatuses: [
      ...["backlog", "planned", "started", "paused", "completed", "canceled"].map((type, i) => ({
        id: `status-${type}`,
        name: type[0]?.toUpperCase() + type.slice(1),
        type,
        position: i,
        teamId: null,
      })),
      { id: "status-lin-started", name: "Doing", type: "started", position: -1, teamId: T.lin },
    ],
    projectLabels: [
      label({
        id: OUTSIDERS.realProjectGroup,
        name: "Area",
        isGroup: true,
        groupType: "singleSelect",
      }),
      label({ id: OUTSIDERS.realProjectChild, name: "Web", parentId: OUTSIDERS.realProjectGroup }),
    ],
    initiativeLabels: [label({ id: OUTSIDERS.realInitiativeLabel, name: "Strategic" })],
    projects: [
      project({ id: OUTSIDERS.linCollidingName, name: "Checkout redesign", teamIds: [T.lin] }),
      project({
        id: OUTSIDERS.linMarked,
        name: "Copied fixture",
        description: descriptionFor("P001"),
        teamIds: [T.lin],
      }),
      project({
        id: OUTSIDERS.sbxMarked,
        name: "Private fixture",
        description: descriptionFor("P002"),
        teamIds: [T.sbx],
      }),
      project({
        id: OUTSIDERS.mixedMarked,
        name: "Shared fixture",
        description: descriptionFor("P003"),
        teamIds: [T.tam, T.lin],
      }),
    ],
    initiatives: [
      initiative({ id: OUTSIDERS.realInitiative, name: "Planning Sheet", leadTeamId: T.lin }),
      initiative({
        id: OUTSIDERS.linLedMarkedInitiative,
        name: "Copied initiative",
        description: descriptionFor("I01"),
        leadTeamId: T.lin,
      }),
    ],
    links: [{ initiativeId: OUTSIDERS.realInitiative, projectId: OUTSIDERS.linCollidingName }],
  };
}

/** Deterministic ids for creates, so plans compare equal across runs in a test. */
export function sequentialIds(prefix = "new"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
