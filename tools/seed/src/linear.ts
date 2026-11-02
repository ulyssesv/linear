// SeedApi on Linear's GraphQL API through @linear/sdk's raw client. Plain queries rather than
// the SDK's lazy models: each page fetches what the planner needs in one request. Field and
// mutation names are those of the schema in @linear/sdk 98.0.0.
import { LinearClient, RatelimitedLinearError } from "@linear/sdk";
import {
  type GroupType,
  type Initiative,
  type Label,
  type Project,
  RateLimitedError,
  type SeedApi,
  type Workspace,
} from "./model.ts";

export type Request = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;

/** Stands for teams beyond the first page of a project's teams; never part of the hierarchy. */
export const MORE_TEAMS = "<more teams>";

const PAGE = 250;
/** Projects and initiatives carry nested connections, so they page in smaller steps to stay
 * well inside Linear's per-query complexity limit. */
const ENTITY_PAGE = 50;
const DEFAULT_WAIT_MS = 60_000;

type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type Ref = { id: string } | null;

const PAGE_INFO = "pageInfo { hasNextPage endCursor }";
const LABEL_FIELDS = "id name isGroup groupType color description retiredAt parent { id }";

async function all<T>(request: Request, field: string, first: number, selection: string) {
  const query =
    `query Seed${field}($first: Int, $after: String) ` +
    `{ ${field}(first: $first, after: $after) { nodes { ${selection} } ${PAGE_INFO} } }`;
  const out: T[] = [];
  let after: string | null = null;
  do {
    const data = (await request(query, { first, after })) as Record<string, Connection<T>>;
    const connection = data[field] as Connection<T>;
    out.push(...connection.nodes);
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after !== null);
  return out;
}

type RawLabel = {
  id: string;
  name: string;
  isGroup: boolean;
  groupType: GroupType | null;
  color: string;
  description: string | null;
  retiredAt: string | null;
  parent: Ref;
  team?: Ref;
};

const label = (l: RawLabel): Label => ({
  id: l.id,
  name: l.name,
  isGroup: l.isGroup,
  groupType: l.groupType ?? null,
  parentId: l.parent?.id ?? null,
  teamId: l.team?.id ?? null,
  color: l.color,
  description: l.description ?? null,
  retiredAt: l.retiredAt ?? null,
});

type RawProject = Omit<Project, "statusId" | "leadId" | "leadTeamId" | "teamIds" | "trashed"> & {
  status: { id: string };
  lead: Ref;
  leadTeam: Ref;
  teams: { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean } };
  trashed: boolean | null;
};

type RawInitiative = Omit<Initiative, "ownerId" | "leadTeamId" | "trashed"> & {
  owner: Ref;
  leadTeam: Ref;
  trashed: boolean | null;
};

/** Drops null and undefined fields: a create leaves unset what it does not set. */
const compact = (input: object) =>
  Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null && v !== undefined));

export function seedApi(request: Request): SeedApi {
  const mutate = async (
    field: string,
    inputType: string,
    variables: { id?: string; input: object },
  ) => {
    const query =
      variables.id === undefined
        ? `mutation Seed${field}($input: ${inputType}!) { ${field}(input: $input) { success } }`
        : `mutation Seed${field}($id: String!, $input: ${inputType}!) ` +
          `{ ${field}(id: $id, input: $input) { success } }`;
    const data = (await request(query, variables)) as Record<string, { success: boolean }>;
    if (!data[field]?.success) throw new Error(`Linear did not apply ${field}`);
  };

  return {
    async readWorkspace(): Promise<Workspace> {
      const teams = await all<{
        id: string;
        key: string;
        name: string;
        private: boolean;
        parent: Ref;
      }>(request, "teams", PAGE, "id key name private parent { id }");
      const users = await all<Workspace["users"][number]>(
        request,
        "users",
        PAGE,
        "id name email active guest app",
      );
      const statuses = await all<{
        id: string;
        name: string;
        type: string;
        position: number;
        team: Ref;
      }>(request, "projectStatuses", PAGE, "id name type position team { id }");
      const projectLabels = await all<RawLabel>(
        request,
        "projectLabels",
        PAGE,
        `${LABEL_FIELDS} team { id }`,
      );
      const initiativeLabels = await all<RawLabel>(request, "initiativeLabels", PAGE, LABEL_FIELDS);
      const projects = await all<RawProject>(
        request,
        "projects",
        ENTITY_PAGE,
        "id name description status { id } lead { id } leadTeam { id } " +
          "teams(first: 10) { nodes { id } pageInfo { hasNextPage } } " +
          "startDate targetDate priority labelIds createdAt trashed",
      );
      const initiatives = await all<RawInitiative>(
        request,
        "initiatives",
        ENTITY_PAGE,
        "id name description status owner { id } leadTeam { id } " +
          "targetDate priority labelIds createdAt trashed",
      );
      const links = await all<{ initiative: Ref; project: Ref }>(
        request,
        "initiativeToProjects",
        PAGE,
        "initiative { id } project { id }",
      );

      return {
        teams: teams.map(({ parent, ...t }) => ({ ...t, parentId: parent?.id ?? null })),
        users,
        projectStatuses: statuses.map(({ team, ...s }) => ({ ...s, teamId: team?.id ?? null })),
        projectLabels: projectLabels.map(label),
        initiativeLabels: initiativeLabels.map(label),
        projects: projects.map(({ status, lead, leadTeam, teams, trashed, ...p }) => ({
          ...p,
          statusId: status.id,
          leadId: lead?.id ?? null,
          leadTeamId: leadTeam?.id ?? null,
          teamIds: [
            ...teams.nodes.map((t) => t.id),
            ...(teams.pageInfo.hasNextPage ? [MORE_TEAMS] : []),
          ],
          trashed: trashed === true,
        })),
        initiatives: initiatives.map(({ owner, leadTeam, trashed, ...i }) => ({
          ...i,
          ownerId: owner?.id ?? null,
          leadTeamId: leadTeam?.id ?? null,
          trashed: trashed === true,
        })),
        links: links.flatMap((l) =>
          l.initiative && l.project
            ? [{ initiativeId: l.initiative.id, projectId: l.project.id }]
            : [],
        ),
      };
    },

    createProjectLabel: (input) =>
      mutate("projectLabelCreate", "ProjectLabelCreateInput", { input: compact(input) }),
    updateProjectLabel: (id, input) =>
      mutate("projectLabelUpdate", "ProjectLabelUpdateInput", { id, input }),
    createInitiativeLabel: (input) =>
      mutate("initiativeLabelCreate", "InitiativeLabelCreateInput", { input: compact(input) }),
    updateInitiativeLabel: (id, input) =>
      mutate("initiativeLabelUpdate", "InitiativeLabelUpdateInput", { id, input }),
    createProject: (input) =>
      mutate("projectCreate", "ProjectCreateInput", { input: compact(input) }),
    updateProject: (id, input) => mutate("projectUpdate", "ProjectUpdateInput", { id, input }),
    createInitiative: (input) =>
      mutate("initiativeCreate", "InitiativeCreateInput", { input: compact(input) }),
    updateInitiative: (id, input) =>
      mutate("initiativeUpdate", "InitiativeUpdateInput", { id, input }),
    linkProject: (input) =>
      mutate("initiativeToProjectCreate", "InitiativeToProjectCreateInput", { input }),
  };
}

/** Linear's rate-limit error as a pause: Retry-After seconds, else until the request budget
 * resets (epoch milliseconds), else a minute. Any other error passes through. */
export function toRateLimited(error: unknown, now = Date.now()): unknown {
  if (!(error instanceof RatelimitedLinearError)) return error;
  const wait =
    error.retryAfter !== undefined
      ? error.retryAfter * 1000
      : error.requestsResetAt !== undefined
        ? error.requestsResetAt - now
        : DEFAULT_WAIT_MS;
  return new RateLimitedError(Math.max(1000, wait));
}

/** The port on a personal API key. */
export function linearApi(apiKey: string): SeedApi {
  const client = new LinearClient({ apiKey });
  return seedApi(async (query, variables) => {
    try {
      return (await client.client.rawRequest(query, variables)).data;
    } catch (error) {
      throw toRateLimited(error);
    }
  });
}
