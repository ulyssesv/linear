import { describe, expect, it } from "vitest";
import { descriptionFor, generateFixtures, LABEL_PREFIX } from "../src/fixtures.ts";
import type { Workspace } from "../src/model.ts";
import { hierarchyOf, type PlanEntry, planSeed, type Step, summarize } from "../src/plan.ts";
import { initiative, label, OUTSIDERS, project, sequentialIds, T, workspace } from "./workspace.ts";

const fixtures = generateFixtures();
const TEST = "Test";

function plan(ws: Workspace = workspace()) {
  return planSeed(fixtures, ws, { teamName: TEST, newId: sequentialIds() });
}

const steps = (entries: PlanEntry[]) => entries.filter((e): e is Step => e.op !== "unchanged");
const outsiderIds = new Set(Object.values(OUTSIDERS));

describe("hierarchyOf", () => {
  it("MIRROR-R27 is the named team and its public descendants, sub-teams ordered by key", () => {
    const result = hierarchyOf(workspace().teams, TEST);
    expect(result.errors).toEqual([]);
    expect(result.teams.map((t) => t.key)).toEqual(["TST", "TAM", "TMB", "TMG"]);
    expect(result.warnings.join("\n")).toMatch(/TPV.*private/);
  });

  it("MIRROR-R28 refuses a private root team and an unknown team", () => {
    const ws = workspace();
    expect(hierarchyOf(ws.teams, "SBX").errors.join()).toMatch(/private/);
    expect(hierarchyOf(ws.teams, "Nope").errors.join()).toMatch(/No team/);
    expect(hierarchyOf(ws.teams, "TST").teams[0]?.id).toBe(T.root);
  });
});

describe("planSeed on a workspace without fixtures", () => {
  const result = plan();
  const all = steps(result.entries);

  it("MIRROR-R27 creates every fixture: labels, projects, initiatives and links", () => {
    expect(result.errors).toEqual([]);
    const count = (kind: string) => all.filter((s) => s.kind === kind && s.op === "create").length;
    expect(count("projectLabel")).toBe(3 + 12);
    expect(count("initiativeLabel")).toBe(1 + 4);
    expect(count("project")).toBe(fixtures.projects.length);
    expect(count("initiative")).toBe(fixtures.initiatives.length);
    expect(count("link")).toBe(fixtures.initiatives.flatMap((i) => i.projectKeys).length);
    expect(all.every((s) => s.op === "create")).toBe(true);
  });

  it("MIRROR-R27 orders phases: label groups, labels, projects and initiatives, links", () => {
    const phases = all.map((s) => s.phase);
    expect(phases).toEqual([...phases].sort((a, b) => a - b));
    const phaseOf = (kind: string, group?: boolean) =>
      new Set(
        all
          .filter((s) => s.kind === kind)
          .filter((s) => group === undefined || ("isGroup" in s.input && s.input.isGroup === group))
          .map((s) => s.phase),
      );
    expect(phaseOf("projectLabel", true)).toEqual(new Set([0]));
    expect(phaseOf("projectLabel", false)).toEqual(new Set([1]));
    expect(phaseOf("project")).toEqual(new Set([2]));
    expect(phaseOf("initiative")).toEqual(new Set([2]));
    expect(phaseOf("link")).toEqual(new Set([3]));
  });

  it("MIRROR-R27 MIRROR-R28 puts projects only in Test and its public sub-teams", () => {
    const hierarchy = new Set([T.root, T.tam, T.tmg, T.tmb]);
    const used = new Set<string>();
    for (const s of all) {
      if (s.kind !== "project" || s.op !== "create") continue;
      expect(s.input.teamIds.every((id) => hierarchy.has(id))).toBe(true);
      expect(s.input.teamIds).toContain(s.input.leadTeamId);
      for (const id of s.input.teamIds) used.add(id);
    }
    expect(used).toEqual(hierarchy);
    for (const s of all) {
      if (s.kind === "initiative" && s.op === "create" && s.input.leadTeamId !== null) {
        expect(hierarchy.has(s.input.leadTeamId)).toBe(true);
      }
    }
  });

  it("MIRROR-R27 resolves statuses to workspace statuses of each type and leads to active members", () => {
    const statuses = new Set<string>();
    const leads = new Set<string | null>();
    for (const s of all) {
      if (s.kind === "project" && s.op === "create") {
        statuses.add(s.input.statusId);
        leads.add(s.input.leadId);
      }
      if (s.kind === "initiative" && s.op === "create") leads.add(s.input.ownerId);
    }
    expect(statuses).toEqual(
      new Set(
        ["backlog", "planned", "started", "paused", "completed", "canceled"].map(
          (t) => `status-${t}`,
        ),
      ),
    );
    expect(leads).toEqual(new Set([null, "u-al", "u-bo", "u-cy"]));
  });

  it("MIRROR-R27 never targets an entity outside the hierarchy, even with a colliding name or marker", () => {
    for (const s of all) {
      if ("id" in s) expect(outsiderIds.has(s.id)).toBe(false);
      if (s.kind === "link") {
        expect(outsiderIds.has(s.input.projectId)).toBe(false);
        expect(outsiderIds.has(s.input.initiativeId)).toBe(false);
      }
      if ("labelIds" in s.input) {
        for (const id of s.input.labelIds ?? []) expect(outsiderIds.has(id)).toBe(false);
      }
    }
    const warnings = result.warnings.join("\n");
    for (const id of [
      OUTSIDERS.linMarked,
      OUTSIDERS.sbxMarked,
      OUTSIDERS.mixedMarked,
      OUTSIDERS.linLedMarkedInitiative,
    ]) {
      expect(warnings).toContain(id);
    }
  });

  it("MIRROR-R27 summarizes counts by kind and action", () => {
    const summary = summarize(result.entries);
    expect(summary.project).toEqual({ create: fixtures.projects.length, update: 0, unchanged: 0 });
    expect(summary.link?.create).toBeGreaterThan(250);
  });
});

/** The workspace after the plan was applied: what a second run reads. */
function seeded(): Workspace {
  const ws = workspace();
  const result = plan(ws);
  for (const s of steps(result.entries)) {
    if (s.op !== "create") continue;
    const at = "2026-11-02T00:00:00.000Z";
    if (s.kind === "projectLabel" || s.kind === "initiativeLabel") {
      const list = s.kind === "projectLabel" ? ws.projectLabels : ws.initiativeLabels;
      list.push(
        label({
          ...s.input,
          groupType: s.input.groupType ?? null,
          parentId: s.input.parentId ?? null,
        }),
      );
    } else if (s.kind === "project") {
      ws.projects.push({ ...s.input, createdAt: at, trashed: false });
    } else if (s.kind === "initiative") {
      ws.initiatives.push({ ...s.input, createdAt: at, trashed: false });
    } else if (s.kind === "link") {
      ws.links.push({ ...s.input });
    }
  }
  return ws;
}

describe("planSeed on a seeded workspace", () => {
  it("MIRROR-R27 changes nothing when every fixture is current", () => {
    const result = plan(seeded());
    expect(result.errors).toEqual([]);
    expect(steps(result.entries)).toEqual([]);
    expect(result.entries.length).toBeGreaterThan(fixtures.projects.length);
  });

  it("MIRROR-R27 updates only the fields that drifted and keeps labels it does not own", () => {
    const ws = seeded();
    const p = ws.projects.find((x) => x.description === descriptionFor("P010"));
    if (!p) throw new Error("P010 missing");
    const want = { ...p };
    p.priority = (p.priority + 1) % 5;
    p.name = "Renamed by hand";
    p.labelIds = [...p.labelIds, OUTSIDERS.realProjectChild];

    const updates = steps(plan(ws).entries);

    expect(updates).toHaveLength(1);
    const [u] = updates;
    expect(u).toMatchObject({ kind: "project", op: "update", id: p.id, key: "P010" });
    expect(u?.fields).toEqual(["name", "priority"]);
    expect(u?.input).toEqual({ name: want.name, priority: want.priority });
  });

  it("MIRROR-R27 restores a seed label set while keeping a foreign label on the project", () => {
    const ws = seeded();
    const p = ws.projects.find((x) => x.labelIds.length > 0);
    if (!p) throw new Error("no labelled project");
    const want = [...p.labelIds];
    p.labelIds = [OUTSIDERS.realProjectChild];

    const [u] = steps(plan(ws).entries);

    expect(u?.fields).toEqual(["labels"]);
    expect(new Set((u?.input as { labelIds?: string[] } | undefined)?.labelIds)).toEqual(
      new Set([...want, OUTSIDERS.realProjectChild]),
    );
  });

  it("MIRROR-R27 matches by marker, not by name, and keeps the oldest of duplicates", () => {
    const ws = seeded();
    const original = ws.projects.find((x) => x.description === descriptionFor("P020"));
    if (!original) throw new Error("P020 missing");
    ws.projects.push({ ...original, id: "dup", createdAt: "2026-12-01T00:00:00.000Z" });

    const result = plan(ws);

    expect(steps(result.entries)).toEqual([]);
    expect(result.warnings.join("\n")).toMatch(/P020.*dup/);
  });

  it("MIRROR-R27 creates afresh when the only marked copy is trashed", () => {
    const ws = seeded();
    const p = ws.projects.find((x) => x.description === descriptionFor("P030"));
    if (!p) throw new Error("P030 missing");
    p.trashed = true;

    const result = steps(plan(ws).entries);

    expect(result.map((s) => `${s.kind} ${s.op} ${s.key}`)).toContain("project create P030");
    expect(result.some((s) => "id" in s && s.id === p.id)).toBe(false);
  });

  it("MIRROR-R27 fixes a seed label group's type and leaves foreign groups alone", () => {
    const ws = seeded();
    const group = ws.projectLabels.find((l) => l.name === `${LABEL_PREFIX}Size`);
    if (!group) throw new Error("no size group");
    group.groupType = "multiSelect";
    const area = ws.projectLabels.find((l) => l.id === OUTSIDERS.realProjectGroup);
    if (area) area.name = `${LABEL_PREFIX}Theme copy`;

    const updates = steps(plan(ws).entries);

    expect(updates).toEqual([
      expect.objectContaining({
        kind: "projectLabel",
        op: "update",
        id: group.id,
        input: { groupType: "singleSelect" },
      }),
    ]);
  });

  it("MIRROR-R27 ignores a marked initiative led by a team outside the hierarchy", () => {
    const ws = seeded();
    ws.initiatives.push(
      initiative({ id: "init-sbx", description: descriptionFor("I02"), leadTeamId: T.sbx }),
    );
    const result = plan(ws);
    expect(steps(result.entries)).toEqual([]);
    expect(result.warnings.join("\n")).toContain("init-sbx");
  });
});

describe("planSeed errors", () => {
  it("MIRROR-R27 fails without the Test team", () => {
    const ws = workspace();
    ws.teams = ws.teams.filter((t) => t.id !== T.root);
    const result = plan(ws);
    expect(result.errors.join()).toMatch(/No team/);
    expect(result.entries).toEqual([]);
  });

  it("MIRROR-R27 fails when a project status type has no workspace status", () => {
    const ws = workspace();
    ws.projectStatuses = ws.projectStatuses.filter((s) => s.type !== "paused");
    expect(plan(ws).errors.join()).toMatch(/paused/);
  });

  it("MIRROR-R27 warns and leaves leads empty when the workspace has no assignable member", () => {
    const ws = workspace();
    ws.users = ws.users.filter((u) => u.guest || u.app || !u.active);
    const result = plan(ws);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join()).toMatch(/member/);
    for (const s of steps(result.entries)) {
      if (s.kind === "project" && s.op === "create") expect(s.input.leadId).toBeNull();
    }
  });

  it("MIRROR-R27 never uses a team-level status of a team outside the hierarchy", () => {
    const ws = workspace();
    ws.projects.push(project({ id: "x", teamIds: [T.tam], description: "real" }));
    for (const s of steps(plan(ws).entries)) {
      if (s.kind === "project" && s.op === "create") {
        expect(s.input.statusId).not.toBe("status-lin-started");
      }
    }
  });
});
