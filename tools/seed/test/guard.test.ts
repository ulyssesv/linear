// The last line of defence: every write is checked against the workspace right before it is
// sent, whatever the plan says (MIRROR-R27, MIRROR-R28).
import { describe, expect, it } from "vitest";
import { descriptionFor, LABEL_PREFIX } from "../src/fixtures.ts";
import { type GuardContext, refusal } from "../src/guard.ts";
import type { Write } from "../src/plan.ts";
import { initiative, label, OUTSIDERS, project, T, workspace } from "./workspace.ts";

function context(): GuardContext {
  const ws = workspace();
  ws.projects.push(
    project({ id: "seed-p", description: descriptionFor("P005"), teamIds: [T.tam, T.tmb] }),
  );
  ws.initiatives.push(
    initiative({ id: "seed-i", description: descriptionFor("I05"), leadTeamId: T.tmg }),
  );
  ws.projectLabels.push(
    label({ id: "seed-g", name: `${LABEL_PREFIX}Theme`, isGroup: true, groupType: "singleSelect" }),
    label({ id: "seed-c", name: "Growth", parentId: "seed-g" }),
  );
  ws.initiativeLabels.push(
    label({ id: "seed-ig", name: `${LABEL_PREFIX}Track`, isGroup: true }),
    label({ id: "seed-ic", name: "Bet", parentId: "seed-ig" }),
  );
  return {
    workspace: ws,
    hierarchy: new Set([T.root, T.tam, T.tmg, T.tmb]),
    created: new Map(),
  };
}

const projectInput = (over: object = {}) => ({
  id: "new-p",
  name: "New",
  description: descriptionFor("P100"),
  teamIds: [T.tam],
  leadTeamId: T.tam,
  statusId: "status-backlog",
  leadId: null,
  startDate: null,
  targetDate: null,
  priority: 1,
  labelIds: ["seed-c"],
  ...over,
});

const initiativeInput = (over: object = {}) => ({
  id: "new-i",
  name: "New",
  description: descriptionFor("I40"),
  status: "Planned" as const,
  ownerId: null,
  leadTeamId: T.root,
  targetDate: null,
  priority: 0,
  labelIds: ["seed-ic"],
  ...over,
});

describe("refusal", () => {
  it("MIRROR-R27 allows writes to seed-owned entities inside the hierarchy", () => {
    const ctx = context();
    const allowed: Write[] = [
      { kind: "project", op: "create", input: projectInput() },
      { kind: "project", op: "update", id: "seed-p", input: { priority: 3, teamIds: [T.root] } },
      { kind: "initiative", op: "create", input: initiativeInput() },
      { kind: "initiative", op: "update", id: "seed-i", input: { leadTeamId: null } },
      { kind: "projectLabel", op: "update", id: "seed-c", input: { color: "#ffffff" } },
      {
        kind: "initiativeLabel",
        op: "update",
        id: "seed-ig",
        input: { groupType: "singleSelect" },
      },
      {
        kind: "projectLabel",
        op: "create",
        input: {
          id: "g2",
          name: `${LABEL_PREFIX}Size`,
          description: "",
          color: "#000",
          isGroup: true,
        },
      },
      {
        kind: "projectLabel",
        op: "create",
        input: {
          id: "c2",
          name: "Small",
          description: "",
          color: "#000",
          isGroup: false,
          parentId: "seed-g",
        },
      },
      { kind: "link", op: "create", input: { initiativeId: "seed-i", projectId: "seed-p" } },
    ];
    for (const write of allowed) expect(refusal(write, ctx)).toBeNull();
  });

  it("MIRROR-R27 MIRROR-R28 refuses to update a project outside the hierarchy, marked or not", () => {
    const ctx = context();
    for (const id of [
      OUTSIDERS.linCollidingName,
      OUTSIDERS.linMarked,
      OUTSIDERS.sbxMarked,
      OUTSIDERS.mixedMarked,
      "unknown",
    ]) {
      expect(
        refusal({ kind: "project", op: "update", id, input: { priority: 1 } }, ctx),
      ).not.toBeNull();
    }
  });

  it("MIRROR-R27 MIRROR-R28 refuses to put a project in a team outside the hierarchy", () => {
    const ctx = context();
    for (const team of [T.lin, T.sbx, T.private]) {
      expect(
        refusal(
          { kind: "project", op: "create", input: projectInput({ teamIds: [T.tam, team] }) },
          ctx,
        ),
      ).toMatch(/hierarchy/);
      expect(
        refusal({ kind: "project", op: "update", id: "seed-p", input: { teamIds: [team] } }, ctx),
      ).toMatch(/hierarchy/);
      expect(
        refusal({ kind: "project", op: "update", id: "seed-p", input: { leadTeamId: team } }, ctx),
      ).toMatch(/hierarchy/);
    }
    expect(
      refusal({ kind: "project", op: "create", input: projectInput({ teamIds: [] }) }, ctx),
    ).not.toBeNull();
    expect(
      refusal({ kind: "project", op: "create", input: projectInput({ leadTeamId: T.root }) }, ctx),
    ).toMatch(/lead team/);
  });

  it("MIRROR-R27 refuses an unmarked create or an update that drops the marker", () => {
    const ctx = context();
    expect(
      refusal({ kind: "project", op: "create", input: projectInput({ description: "x" }) }, ctx),
    ).toMatch(/marker/);
    expect(
      refusal({ kind: "project", op: "update", id: "seed-p", input: { description: "x" } }, ctx),
    ).toMatch(/marker/);
    expect(
      refusal(
        { kind: "initiative", op: "create", input: initiativeInput({ description: "" }) },
        ctx,
      ),
    ).toMatch(/marker/);
  });

  it("MIRROR-R27 refuses initiatives that are not seed-owned or led from outside", () => {
    const ctx = context();
    for (const id of [OUTSIDERS.realInitiative, OUTSIDERS.linLedMarkedInitiative]) {
      expect(
        refusal({ kind: "initiative", op: "update", id, input: { priority: 1 } }, ctx),
      ).not.toBeNull();
    }
    expect(
      refusal(
        { kind: "initiative", op: "update", id: "seed-i", input: { leadTeamId: T.lin } },
        ctx,
      ),
    ).toMatch(/hierarchy/);
    expect(
      refusal(
        { kind: "initiative", op: "create", input: initiativeInput({ leadTeamId: T.sbx }) },
        ctx,
      ),
    ).toMatch(/hierarchy/);
  });

  it("MIRROR-R27 refuses labels the tool does not own and foreign labels on new entities", () => {
    const ctx = context();
    for (const id of [OUTSIDERS.realProjectGroup, OUTSIDERS.realProjectChild]) {
      expect(
        refusal({ kind: "projectLabel", op: "update", id, input: { color: "#fff" } }, ctx),
      ).not.toBeNull();
    }
    expect(
      refusal(
        { kind: "initiativeLabel", op: "update", id: OUTSIDERS.realInitiativeLabel, input: {} },
        ctx,
      ),
    ).not.toBeNull();
    expect(
      refusal({ kind: "projectLabel", op: "update", id: "seed-g", input: { name: "Theme" } }, ctx),
    ).toMatch(/prefix/);
    expect(
      refusal(
        {
          kind: "projectLabel",
          op: "create",
          input: { id: "x", name: "Area 2", description: "", color: "#000", isGroup: true },
        },
        ctx,
      ),
    ).toMatch(/prefix/);
    expect(
      refusal(
        {
          kind: "projectLabel",
          op: "create",
          input: {
            id: "x",
            name: "Mobile",
            description: "",
            color: "#000",
            isGroup: false,
            parentId: OUTSIDERS.realProjectGroup,
          },
        },
        ctx,
      ),
    ).not.toBeNull();
    expect(
      refusal(
        {
          kind: "project",
          op: "create",
          input: projectInput({ labelIds: [OUTSIDERS.realProjectChild] }),
        },
        ctx,
      ),
    ).toMatch(/label/);
    expect(
      refusal(
        {
          kind: "project",
          op: "update",
          id: "seed-p",
          input: { labelIds: [OUTSIDERS.realProjectChild] },
        },
        ctx,
      ),
    ).toMatch(/label/);
  });

  it("MIRROR-R27 refuses links that touch a project or initiative outside the hierarchy", () => {
    const ctx = context();
    expect(
      refusal(
        {
          kind: "link",
          op: "create",
          input: { initiativeId: OUTSIDERS.realInitiative, projectId: "seed-p" },
        },
        ctx,
      ),
    ).not.toBeNull();
    expect(
      refusal(
        {
          kind: "link",
          op: "create",
          input: { initiativeId: "seed-i", projectId: OUTSIDERS.linMarked },
        },
        ctx,
      ),
    ).not.toBeNull();
  });

  it("MIRROR-R27 accepts references to entities created earlier in the same run", () => {
    const ctx = context();
    const group: Write = {
      kind: "initiativeLabel",
      op: "create",
      input: {
        id: "g-new",
        name: `${LABEL_PREFIX}New`,
        description: "",
        color: "#000",
        isGroup: true,
      },
    };
    const child: Write = {
      kind: "initiativeLabel",
      op: "create",
      input: {
        id: "c-new",
        name: "One",
        description: "",
        color: "#000",
        isGroup: false,
        parentId: "g-new",
      },
    };
    const p: Write = { kind: "project", op: "create", input: projectInput() };
    const i: Write = {
      kind: "initiative",
      op: "create",
      input: initiativeInput({ labelIds: ["c-new"] }),
    };
    const link: Write = {
      kind: "link",
      op: "create",
      input: { initiativeId: "new-i", projectId: "new-p" },
    };

    expect(refusal(child, ctx)).not.toBeNull();
    for (const write of [group, child, p, i, link]) {
      expect(refusal(write, ctx)).toBeNull();
      if (write.op === "create" && write.kind !== "link") ctx.created.set(write.input.id, write);
    }
  });
});
