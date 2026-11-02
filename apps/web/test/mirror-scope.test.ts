// The scope filter (MIRROR-R12): pure rules over normalised records, shared by the
// bootstrap here and the webhook receiver and reconcile pass later.
import { describe, expect, it } from "vitest";
import {
  initiativeFromNode,
  projectFromNode,
  projectLabelFromNode,
  teamFromNode,
} from "../src/server/mirror/listing.ts";
import {
  scopeInitiative,
  scopeProject,
  scopeProjectLabel,
  scopeRecords,
  scopeTeams,
} from "../src/server/mirror/scope.ts";
import type { Team } from "../src/server/mirror/types.ts";
import { fixtureWorkspace, initiative, project } from "./mirror-fixtures.ts";

const workspace = fixtureWorkspace();
const teams = workspace.teams.map(teamFromNode);
const publicTeams = new Set(["team-test", "team-test-a", "team-ops"]);

function team(id: string, options: Partial<Team> = {}): Team {
  return {
    id,
    name: id,
    key: id.toUpperCase(),
    displayName: id,
    parentId: null,
    private: false,
    updatedAt: "2026-10-01T00:00:00.000Z",
    archivedAt: null,
    ...options,
  };
}

describe("scopeTeams", () => {
  it("MIRROR-R12 drops private teams and every team below one", () => {
    expect(scopeTeams(teams).map((t) => t.id)).toEqual(["team-test", "team-test-a", "team-ops"]);
  });

  it("MIRROR-R12 fails closed on a parent missing from the listing or a parent cycle", () => {
    const orphan = team("orphan", { parentId: "not-listed" });
    const a = team("a", { parentId: "b" });
    const b = team("b", { parentId: "a" });
    const deep = [
      team("root"),
      team("mid", { parentId: "root" }),
      team("leaf", { parentId: "mid" }),
    ];
    expect(scopeTeams([orphan, a, b, ...deep]).map((t) => t.id)).toEqual(["root", "mid", "leaf"]);
    const privateRoot = [team("root", { private: true }), ...deep.slice(1)];
    expect(scopeTeams(privateRoot)).toEqual([]);
  });
});

describe("scopeProject", () => {
  it("MIRROR-R12 keeps a project in public and private teams with the private ones stripped", () => {
    const mixed = projectFromNode(project("p", ["team-sbx", "team-test", "team-sbx-child"]));
    expect(scopeProject(mixed, publicTeams)?.teamIds).toEqual(["team-test"]);
  });

  it("MIRROR-R12 drops a project only in private teams, or in teams it does not know", () => {
    expect(scopeProject(projectFromNode(project("p", ["team-sbx"])), publicTeams)).toBeNull();
    expect(scopeProject(projectFromNode(project("p", ["team-new"])), publicTeams)).toBeNull();
    expect(scopeProject(projectFromNode(project("p", [])), publicTeams)).toBeNull();
  });
});

describe("scopeInitiative", () => {
  it("MIRROR-R12 keeps an initiative led by a public team or by no team", () => {
    const led = scopeInitiative(initiativeFromNode(initiative("i", "team-test")), publicTeams);
    expect(led).toMatchObject({ id: "i", leadTeamId: "team-test" });
    expect(led).not.toHaveProperty("visibility");
    expect(scopeInitiative(initiativeFromNode(initiative("i", null)), publicTeams)).not.toBeNull();
  });

  it("MIRROR-R12 drops an initiative led by a private or unknown team, or not public", () => {
    const of = (lead: string | null, visibility: string | null) =>
      scopeInitiative(initiativeFromNode(initiative("i", lead, { visibility })), publicTeams);
    expect(of("team-sbx", "public")).toBeNull();
    expect(of("team-new", "public")).toBeNull();
    expect(of(null, "private")).toBeNull();
    expect(of("team-test", "restricted")).toBeNull();
    // A webhook payload carries no visibility; the lead team decides alone.
    expect(of("team-test", null)).not.toBeNull();
  });
});

describe("scopeProjectLabel", () => {
  it("MIRROR-R12 drops a label scoped to a private team and keeps workspace labels", () => {
    const labels = workspace.projectLabels.map(projectLabelFromNode);
    const kept = labels.flatMap((l) => scopeProjectLabel(l, publicTeams) ?? []).map((l) => l.id);
    expect(kept).not.toContain("plabel-sbx");
    expect(kept).toContain("plabel-test-only");
    expect(kept).toContain("plabel-bet");
  });
});

describe("scopeRecords", () => {
  it("MIRROR-R12 filters a listing of any type with the same rules", () => {
    const projects = workspace.projects.map(projectFromNode);
    expect(scopeRecords("projects", projects, publicTeams).map((p) => p.id)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
    const initiatives = workspace.initiatives.map(initiativeFromNode);
    expect(scopeRecords("initiatives", initiatives, publicTeams).map((i) => i.id)).toEqual([
      "i1",
      "i2",
    ]);
    expect(scopeRecords("teams", teams, publicTeams).map((t) => t.id)).toEqual([
      "team-test",
      "team-test-a",
      "team-ops",
    ]);
  });
});
