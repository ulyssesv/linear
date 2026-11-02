// Listing every entity of a type from Linear, page by page, and normalising the nodes
// (MIRROR-R9, MIRROR-R10). Used by the bootstrap; the reconcile pass (T5) can reuse the
// queries with an updatedAt filter.
//
// The selections and page sizes are the shapes in ../linear/budget.ts, which the budget
// test checks against these query texts. Every field was checked against the schema in
// @linear/sdk 98.0.0. Notes from that check:
// - Initiative status is an enum (Proposed, Planned, Active, Completed, Canceled); Linear
//   has no initiative status entity or query, so initiativeStatuses below is that list and
//   costs no request.
// - Initiatives have a lead team (`leadTeam`) and a derived `visibility`, but no teams
//   connection. Projects and initiatives expose `labelIds` as a scalar list, cheaper than
//   a labels connection.
// - A label group is a label with `isGroup`; `groupType` is singleSelect, multiSelect, or
//   null, which Linear treats as single-select.
// - `identifier` on projects and initiatives is marked [Internal] in the schema; it is
//   nullable and kept next to `slugId` and `url`, which are public.
// - Archived entities are listed (`includeArchived`) so the mirror knows they are archived;
//   trashed projects and initiatives are left out, as if Linear no longer returned them.

import { bootstrapPlan } from "../linear/budget.ts";
import type { LinearClient } from "../linear/client.ts";
import type { InitiativeCandidate } from "./scope.ts";
import type {
  InitiativeLabel,
  InitiativeStatus,
  LatestUpdate,
  Project,
  ProjectLabel,
  ProjectStatus,
  Team,
  User,
} from "./types.ts";

const pageInfo = "pageInfo { hasNextPage endCursor }";

export const listingQueries = {
  teams: `query MirrorTeams($first: Int!, $after: String) {
  teams(first: $first, after: $after, includeArchived: true) {
    nodes { id name key displayName private archivedAt updatedAt parent { id } }
    ${pageInfo}
  }
}`,
  users: `query MirrorUsers($first: Int!, $after: String) {
  users(first: $first, after: $after, includeArchived: true, includeDisabled: true) {
    nodes { id name displayName email avatarUrl active archivedAt updatedAt }
    ${pageInfo}
  }
}`,
  projectStatuses: `query MirrorProjectStatuses($first: Int!, $after: String) {
  projectStatuses(first: $first, after: $after, includeArchived: true) {
    nodes { id name type color position archivedAt updatedAt }
    ${pageInfo}
  }
}`,
  projectLabels: `query MirrorProjectLabels($first: Int!, $after: String) {
  projectLabels(first: $first, after: $after, includeArchived: true) {
    nodes { id name color isGroup groupType archivedAt updatedAt parent { id } team { id } }
    ${pageInfo}
  }
}`,
  initiativeLabels: `query MirrorInitiativeLabels($first: Int!, $after: String) {
  initiativeLabels(first: $first, after: $after, includeArchived: true) {
    nodes { id name color isGroup groupType archivedAt updatedAt parent { id } }
    ${pageInfo}
  }
}`,
  projects: `query MirrorProjects($first: Int!, $after: String) {
  projects(first: $first, after: $after, includeArchived: true) {
    nodes {
      id name slugId identifier url startDate targetDate priority health progress
      createdAt updatedAt archivedAt completedAt canceledAt trashed labelIds
      lead { id }
      status { id }
      lastUpdate { id body health createdAt }
      teams(first: 25, includeArchived: true) { nodes { id } }
      initiatives(first: 25, includeArchived: true) { nodes { id } }
    }
    ${pageInfo}
  }
}`,
  initiatives: `query MirrorInitiatives($first: Int!, $after: String) {
  initiatives(first: $first, after: $after, includeArchived: true) {
    nodes {
      id name slugId identifier url status targetDate priority health
      createdAt updatedAt archivedAt completedAt trashed visibility labelIds
      owner { id }
      leadTeam { id }
      lastUpdate { id body health createdAt }
      projects(first: 50, includeArchived: true) { nodes { id } }
    }
    ${pageInfo}
  }
}`,
} as const;

export type ListedType = keyof typeof listingQueries;

type Ref = { id: string } | null | undefined;
type Connection = { nodes: { id: string }[] } | null | undefined;
type Node = Record<string, unknown>;
type Page = { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

const maxPages = 10_000;

/** Every node of a listed type, following cursors until Linear says there is no more. */
export async function listAll(client: LinearClient, type: ListedType): Promise<Node[]> {
  const { pageSize } = bootstrapPlan[type];
  const nodes: Node[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data: Record<string, Page> = await client.request(listingQueries[type], {
      first: pageSize,
      after,
    });
    const connection = data[type];
    if (!connection || !Array.isArray(connection.nodes)) {
      throw new Error(`Linear returned no ${type} connection`);
    }
    nodes.push(...connection.nodes);
    if (!connection.pageInfo?.hasNextPage) return nodes;
    if (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === after) {
      throw new Error(`Linear returned a ${type} page without a new cursor`);
    }
    after = connection.pageInfo.endCursor;
  }
  throw new Error(`Listing ${type} took more than ${maxPages} pages`);
}

const str = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));
const strOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const num = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));
const ref = (value: unknown): string | null => (value as Ref)?.id ?? null;
const refs = (value: unknown): string[] => ((value as Connection)?.nodes ?? []).map((n) => n.id);
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

const excerptLength = 280;

/** The start of an update's markdown, whitespace collapsed, for the latest-update cell. */
export function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= excerptLength ? flat : `${flat.slice(0, excerptLength - 1).trimEnd()}…`;
}

function latestUpdate(value: unknown): LatestUpdate | null {
  if (!value || typeof value !== "object") return null;
  const update = value as Node;
  return {
    id: str(update.id),
    excerpt: excerpt(str(update.body)),
    health: strOrNull(update.health),
    createdAt: str(update.createdAt),
  };
}

function tracked(node: Node) {
  return {
    id: str(node.id),
    updatedAt: str(node.updatedAt),
    archivedAt: strOrNull(node.archivedAt),
  };
}

export function teamFromNode(node: Node): Team {
  return {
    ...tracked(node),
    name: str(node.name),
    key: str(node.key),
    displayName: str(node.displayName),
    parentId: ref(node.parent),
    private: node.private === true,
  };
}

export function userFromNode(node: Node): User {
  return {
    ...tracked(node),
    name: str(node.name),
    displayName: str(node.displayName),
    email: str(node.email),
    avatarUrl: strOrNull(node.avatarUrl),
    active: node.active !== false,
  };
}

export function projectStatusFromNode(node: Node): ProjectStatus {
  return {
    ...tracked(node),
    name: str(node.name),
    type: str(node.type),
    color: str(node.color),
    position: num(node.position),
  };
}

function labelFromNode(node: Node): InitiativeLabel {
  const isGroup = node.isGroup === true;
  return {
    ...tracked(node),
    name: str(node.name),
    color: str(node.color),
    isGroup,
    selection: isGroup ? (node.groupType === "multiSelect" ? "multi" : "single") : null,
    parentId: ref(node.parent),
  };
}

export function projectLabelFromNode(node: Node): ProjectLabel {
  return { ...labelFromNode(node), teamId: ref(node.team) };
}

export const initiativeLabelFromNode = labelFromNode;

export function projectFromNode(node: Node): Project {
  return {
    ...tracked(node),
    name: str(node.name),
    slugId: str(node.slugId),
    identifier: strOrNull(node.identifier),
    url: str(node.url),
    statusId: ref(node.status),
    leadId: ref(node.lead),
    startDate: strOrNull(node.startDate),
    targetDate: strOrNull(node.targetDate),
    priority: num(node.priority),
    health: strOrNull(node.health),
    progress: num(node.progress),
    teamIds: refs(node.teams),
    initiativeIds: refs(node.initiatives),
    labelIds: list(node.labelIds),
    lastUpdate: latestUpdate(node.lastUpdate),
    createdAt: str(node.createdAt),
    completedAt: strOrNull(node.completedAt),
    canceledAt: strOrNull(node.canceledAt),
  };
}

export function initiativeFromNode(node: Node): InitiativeCandidate {
  return {
    ...tracked(node),
    name: str(node.name),
    slugId: str(node.slugId),
    identifier: strOrNull(node.identifier),
    url: str(node.url),
    status: str(node.status),
    ownerId: ref(node.owner),
    leadTeamId: ref(node.leadTeam),
    targetDate: strOrNull(node.targetDate),
    priority: num(node.priority),
    health: strOrNull(node.health),
    projectIds: refs(node.projects),
    labelIds: list(node.labelIds),
    lastUpdate: latestUpdate(node.lastUpdate),
    createdAt: str(node.createdAt),
    completedAt: strOrNull(node.completedAt),
    visibility: strOrNull(node.visibility),
  };
}

/** Trashed entities count as gone: Linear deletes them after a grace period. */
export function notTrashed(node: Node): boolean {
  return node.trashed !== true;
}

/**
 * The initiative statuses of Linear's schema, in lifecycle order. Linear has no query for
 * them; `updatedAt` is the date this list was checked against the schema, so a re-run
 * finds nothing changed.
 */
export const initiativeStatuses: readonly InitiativeStatus[] = [
  "Proposed",
  "Planned",
  "Active",
  "Completed",
  "Canceled",
].map((name, position) => ({
  id: name,
  name,
  position,
  updatedAt: "2026-11-02T00:00:00.000Z",
  archivedAt: null,
}));
