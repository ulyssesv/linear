// A recorded-shape Linear workspace for the mirror tests: GraphQL nodes as the listing
// queries select them, served page by page through a fake fetch. No test reaches the
// network.
//
// The workspace has a public team with a sub-team, a second public team, and a private
// team (Sandbox, SBX) with a sub-team of its own. Everything whose id contains "sbx" must
// never reach the mirror (MIRROR-R12).
import type { ListedType } from "../src/server/mirror/listing.ts";
import { json, type Recorded, tokenResponse } from "./linear-fakes.ts";

export type Node = Record<string, unknown>;
export type Workspace = Record<ListedType, Node[]>;

const at = (day: number) => new Date(Date.UTC(2026, 9, day)).toISOString();
const ref = (id: string | null) => (id === null ? null : { id });
const nodes = (...ids: string[]) => ({ nodes: ids.map((id) => ({ id })) });

function team(id: string, name: string, key: string, options: Partial<Node> = {}): Node {
  return {
    id,
    name,
    key,
    displayName: name,
    private: false,
    archivedAt: null,
    updatedAt: at(1),
    parent: null,
    ...options,
  };
}

function user(id: string, name: string): Node {
  return {
    id,
    name,
    displayName: name.toLowerCase(),
    email: `${name.toLowerCase()}@example.com`,
    avatarUrl: null,
    active: true,
    archivedAt: null,
    updatedAt: at(1),
  };
}

function status(id: string, name: string, type: string, position: number): Node {
  return { id, name, type, color: "#888888", position, archivedAt: null, updatedAt: at(1) };
}

function label(id: string, name: string, options: Partial<Node> = {}): Node {
  return {
    id,
    name,
    color: "#eb5757",
    isGroup: false,
    groupType: null,
    archivedAt: null,
    updatedAt: at(1),
    parent: null,
    ...options,
  };
}

export function project(id: string, teams: string[], options: Partial<Node> = {}): Node {
  return {
    id,
    name: `Project ${id}`,
    slugId: `${id}-slug`,
    identifier: `P-TST-${id}`,
    url: `https://linear.app/sesv/project/${id}-slug`,
    startDate: "2026-10-01",
    targetDate: "2026-12-31",
    priority: 2,
    health: "onTrack",
    progress: 0.25,
    createdAt: at(1),
    updatedAt: at(2),
    archivedAt: null,
    completedAt: null,
    canceledAt: null,
    trashed: null,
    labelIds: [],
    lead: ref("user-ana"),
    status: ref("status-started"),
    lastUpdate: null,
    teams: nodes(...teams),
    initiatives: nodes(),
    ...options,
  };
}

export function initiative(id: string, leadTeam: string | null, options: Partial<Node> = {}): Node {
  return {
    id,
    name: `Initiative ${id}`,
    slugId: `${id}-slug`,
    identifier: `I-${id}`,
    url: `https://linear.app/sesv/initiative/${id}-slug`,
    status: "Active",
    targetDate: "2027-03-31",
    priority: 1,
    health: null,
    createdAt: at(1),
    updatedAt: at(2),
    archivedAt: null,
    completedAt: null,
    trashed: null,
    visibility: "public",
    labelIds: [],
    owner: ref("user-ben"),
    leadTeam: ref(leadTeam),
    lastUpdate: null,
    projects: nodes(),
    ...options,
  };
}

/** A fresh copy of the fixture workspace; tests change it freely. */
export function fixtureWorkspace(): Workspace {
  return {
    teams: [
      team("team-test", "Test", "TST"),
      team("team-test-a", "Test A", "TSA", { parent: ref("team-test") }),
      team("team-ops", "Ops", "OPS", { archivedAt: at(3) }),
      team("team-sbx", "Sandbox", "SBX", { private: true }),
      team("team-sbx-child", "Sandbox child", "SBC", { parent: ref("team-sbx") }),
    ],
    users: [user("user-ana", "Ana"), user("user-ben", "Ben")],
    projectStatuses: [
      status("status-backlog", "Backlog", "backlog", 0),
      status("status-started", "In progress", "started", 1),
      status("status-done", "Completed", "completed", 2),
    ],
    projectLabels: [
      label("plabel-size", "Size", { isGroup: true, groupType: null }),
      label("plabel-size-s", "S", { parent: ref("plabel-size") }),
      label("plabel-theme", "Theme", { isGroup: true, groupType: "multiSelect" }),
      label("plabel-bet", "Bet"),
      label("plabel-test-only", "Test only", { team: ref("team-test") }),
      label("plabel-sbx", "Sandbox only", { team: ref("team-sbx") }),
    ],
    initiativeLabels: [
      label("ilabel-horizon", "Horizon", { isGroup: true, groupType: "singleSelect" }),
      label("ilabel-horizon-h1", "H1", { parent: ref("ilabel-horizon") }),
      label("ilabel-pillar", "Pillar"),
    ],
    projects: [
      project("p1", ["team-test"], {
        labelIds: ["plabel-size-s", "plabel-bet"],
        initiatives: nodes("i1"),
        lastUpdate: {
          id: "pu-1",
          body: "Shipped   the\n\nfirst milestone.",
          health: "onTrack",
          createdAt: at(4),
        },
      }),
      project("p2", ["team-test-a", "team-sbx"], { lead: null, startDate: null }),
      project("p3", ["team-ops"], { archivedAt: at(5) }),
      project("p4", ["team-test"], { trashed: true }),
      project("sbx-p1", ["team-sbx"]),
      project("sbx-p2", ["team-sbx-child"]),
    ],
    initiatives: [
      initiative("i1", "team-test", {
        projects: nodes("p1", "sbx-p1"),
        labelIds: ["ilabel-horizon-h1"],
        lastUpdate: { id: "iu-1", body: "On track.", health: "onTrack", createdAt: at(4) },
      }),
      initiative("i2", null, { status: "Planned", owner: null }),
      initiative("sbx-i1", "team-sbx", { visibility: "private" }),
      initiative("sbx-i2", "team-sbx-child"),
    ],
  };
}

export type FakeLinear = {
  fetch: typeof globalThis.fetch;
  calls: Recorded[];
  /** The GraphQL requests, decoded. */
  queries(): { query: string; variables: Record<string, unknown> }[];
};

/**
 * A fetch that issues an app token and answers the listing queries from `workspace`,
 * `pageSize` nodes at a time whatever `first` asks, so small fixtures still page.
 * `fail(type)` returning a Response replaces the answer for that type.
 */
export function fakeLinear(
  workspace: Workspace,
  options: { pageSize?: number; fail?: (type: string) => Response | undefined } = {},
): FakeLinear {
  const calls: Recorded[] = [];
  const pageSize = options.pageSize ?? 2;
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith("/oauth/token")) return tokenResponse("app-token");
    const { query, variables } = JSON.parse(String(init.body)) as {
      query: string;
      variables: { first: number; after: string | null };
    };
    const type = /\{\s*(\w+)\(/.exec(query)?.[1] as ListedType;
    const failure = options.fail?.(type);
    if (failure) return failure;
    const all = workspace[type] ?? [];
    const start = variables.after ? Number(variables.after) : 0;
    const end = Math.min(start + Math.min(pageSize, variables.first), all.length);
    return json({
      data: {
        [type]: {
          nodes: all.slice(start, end),
          pageInfo: {
            hasNextPage: end < all.length,
            endCursor: end < all.length ? String(end) : null,
          },
        },
      },
    });
  };
  return {
    fetch: fetch as typeof globalThis.fetch,
    calls,
    queries: () =>
      calls
        .filter((call) => call.url.endsWith("/graphql"))
        .map((call) => JSON.parse(String(call.init.body))),
  };
}

export const appEnv = { LINEAR_CLIENT_ID: "client-id", LINEAR_CLIENT_SECRET: "client-secret" };
