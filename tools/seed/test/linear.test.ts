import { RatelimitedLinearError } from "@linear/sdk";
import { describe, expect, it } from "vitest";
import { MORE_TEAMS, seedApi, toRateLimited } from "../src/linear.ts";
import { RateLimitedError } from "../src/model.ts";

type Call = { query: string; variables: Record<string, unknown> | undefined };

const page = (nodes: unknown[], endCursor: string | null) => ({
  nodes,
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
});

function fakeRequest(responses: Record<string, (vars: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const request = async (query: string, variables?: Record<string, unknown>) => {
    calls.push({ query, variables });
    const field = /\{\s*(\w+)\(/.exec(query)?.[1] ?? "";
    const respond = responses[field];
    if (!respond) throw new Error(`unexpected ${field}`);
    return { [field]: respond(variables ?? {}) };
  };
  return { request, calls };
}

const empty = () => page([], null);

describe("seedApi", () => {
  it("MIRROR-R27 pages through every connection and maps nested ids", async () => {
    const { request, calls } = fakeRequest({
      teams: () =>
        page(
          [
            { id: "t1", key: "TST", name: "Test", private: false, parent: null },
            { id: "t2", key: "TAM", name: "A", private: false, parent: { id: "t1" } },
          ],
          null,
        ),
      users: empty,
      projectStatuses: () =>
        page([{ id: "s1", name: "Backlog", type: "backlog", position: 0, team: null }], null),
      projectLabels: () =>
        page(
          [
            {
              id: "l1",
              name: "Fixture Theme",
              isGroup: true,
              groupType: "singleSelect",
              parent: null,
              team: null,
              color: "#000",
              description: null,
              retiredAt: null,
            },
          ],
          null,
        ),
      initiativeLabels: empty,
      projects: (vars) =>
        vars.after === undefined || vars.after === null
          ? page(
              [
                {
                  id: "p1",
                  name: "One",
                  description: "d",
                  status: { id: "s1" },
                  lead: null,
                  leadTeam: { id: "t2" },
                  teams: { nodes: [{ id: "t2" }], pageInfo: { hasNextPage: false } },
                  startDate: "2026-01-05",
                  targetDate: null,
                  priority: 2,
                  labelIds: ["l1"],
                  createdAt: "2026-01-01T00:00:00.000Z",
                  trashed: null,
                },
              ],
              "cursor-1",
            )
          : page(
              [
                {
                  id: "p2",
                  name: "Two",
                  description: "",
                  status: { id: "s1" },
                  lead: { id: "u1" },
                  leadTeam: null,
                  teams: { nodes: [{ id: "t1" }], pageInfo: { hasNextPage: true } },
                  startDate: null,
                  targetDate: null,
                  priority: 0,
                  labelIds: [],
                  createdAt: "2026-01-02T00:00:00.000Z",
                  trashed: true,
                },
              ],
              null,
            ),
      initiatives: () =>
        page(
          [
            {
              id: "i1",
              name: "I",
              description: null,
              status: "Active",
              owner: { id: "u1" },
              leadTeam: null,
              targetDate: "2026-06-30",
              priority: 1,
              labelIds: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              trashed: false,
            },
          ],
          null,
        ),
      initiativeToProjects: () => page([{ initiative: { id: "i1" }, project: { id: "p1" } }], null),
    });

    const ws = await seedApi(request).readWorkspace();

    expect(ws.teams[1]).toEqual({
      id: "t2",
      key: "TAM",
      name: "A",
      private: false,
      parentId: "t1",
    });
    expect(ws.projectStatuses[0]?.teamId).toBeNull();
    expect(ws.projectLabels[0]).toMatchObject({ isGroup: true, parentId: null, teamId: null });
    expect(ws.projects.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(ws.projects[0]).toMatchObject({
      statusId: "s1",
      leadId: null,
      leadTeamId: "t2",
      teamIds: ["t2"],
      trashed: false,
    });
    // A project in more teams than one page shows is never mistaken for a hierarchy project.
    expect(ws.projects[1]?.teamIds).toEqual(["t1", MORE_TEAMS]);
    expect(ws.initiatives[0]).toMatchObject({ ownerId: "u1", leadTeamId: null, status: "Active" });
    expect(ws.links).toEqual([{ initiativeId: "i1", projectId: "p1" }]);
    const projectCalls = calls.filter((c) => c.query.includes("projects("));
    expect(projectCalls.map((c) => c.variables?.after ?? null)).toEqual([null, "cursor-1"]);
    expect(calls.every((c) => !/mutation/.test(c.query))).toBe(true);
  });

  it("MIRROR-R27 sends each write as the schema's mutation and checks success", async () => {
    const calls: Call[] = [];
    const request = async (query: string, variables?: Record<string, unknown>) => {
      calls.push({ query, variables });
      const field = /\{\s*(\w+)\(/.exec(query)?.[1] ?? "";
      return { [field]: { success: field !== "initiativeUpdate" } };
    };
    const api = seedApi(request);

    await api.createProject({
      id: "p",
      name: "N",
      description: "d",
      teamIds: ["t"],
      leadTeamId: "t",
      statusId: "s",
      leadId: null,
      startDate: null,
      targetDate: "2026-02-01",
      priority: 1,
      labelIds: [],
    });
    await api.updateProject("p", { leadId: null, priority: 2 });
    await api.createProjectLabel({
      id: "l",
      name: "Fixture X",
      description: "",
      color: "#000",
      isGroup: true,
      groupType: "singleSelect",
    });
    await api.updateInitiativeLabel("il", { color: "#fff" });
    await api.linkProject({ initiativeId: "i", projectId: "p" });
    await expect(api.updateInitiative("i", { priority: 1 })).rejects.toThrow(/did not/);

    expect(calls.map((c) => /\{\s*(\w+)\(/.exec(c.query)?.[1])).toEqual([
      "projectCreate",
      "projectUpdate",
      "projectLabelCreate",
      "initiativeLabelUpdate",
      "initiativeToProjectCreate",
      "initiativeUpdate",
    ]);
    expect(calls[0]?.query).toMatch(/\$input: ProjectCreateInput!/);
    // Creates omit empty optional fields; updates keep null so a field can be cleared.
    expect(calls[0]?.variables?.input).not.toHaveProperty("leadId");
    expect(calls[0]?.variables?.input).not.toHaveProperty("startDate");
    expect(calls[1]?.variables).toEqual({ id: "p", input: { leadId: null, priority: 2 } });
    expect(calls.some((c) => /delete|archive|team(Create|Update)/i.test(c.query))).toBe(false);
  });
});

describe("toRateLimited", () => {
  it("MIRROR-R27 turns Linear's rate-limit error into a pause, honouring the wait it asks for", () => {
    const withRetryAfter = Object.assign(new RatelimitedLinearError(), { retryAfter: 42 });
    expect(toRateLimited(withRetryAfter, 0)).toEqual(new RateLimitedError(42_000));

    const withReset = Object.assign(new RatelimitedLinearError(), { requestsResetAt: 90_000 });
    expect((toRateLimited(withReset, 30_000) as RateLimitedError).waitMs).toBe(60_000);

    const bare = new RatelimitedLinearError();
    expect((toRateLimited(bare, 0) as RateLimitedError).waitMs).toBe(60_000);

    const other = new Error("boom");
    expect(toRateLimited(other, 0)).toBe(other);
  });
});
