// Request and complexity budget of a bootstrap (MIRROR-R4) and of a reconcile pass
// (MIRROR-R13).
//
// Linear's hourly limits for an OAuth app, which covers the client-credentials app actor
// (https://linear.app/developers/rate-limiting, read 2026-11-02): 5,000 requests and
// 2,000,000 complexity points per hour, and no single query above 10,000 points.
//
// Complexity, per the same page: each property 0.1 point, each object 1 point, and a
// connection multiplies its children's points by its `first` argument (default 50),
// rounded up per query. Linear charges the requested page size, not the rows returned,
// so the estimate below is an upper bound for a page however full it is.
//
// The bootstrap (../mirror/bootstrap.ts) pages through every entity type with the page
// sizes and selections below. Its queries select exactly these shapes, which the budget
// test checks; when a query grows, grow the shape here and let the test check the budget
// again.
//
// Arithmetic for the fixture workspace (about 300 projects and 60 initiatives, MIRROR-R27,
// plus the reference data), with the shapes below:
//
//   project node      1 + 17 x 0.1 + lead 1.1 + status 1.1 + lastUpdate 1.4
//                     + teams, initiatives 2 x 25 x (1 + 0.1)               =  61.3
//   projects page     50 x 61.3 + pageInfo 1.2, rounded up                  = 3,067
//   initiative node   1 + 16 x 0.1 + owner 1.1 + leadTeam 1.1 + lastUpdate 1.4
//                     + projects 50 x 1.1                                   =  61.2
//   initiatives page  50 x 61.2 + 1.2, rounded up                           = 3,062
//   reference pages   100 x (1.7 to 3.9) + 1.2, rounded up                  = 172 to 392
//
//   projects          ceil(300 / 50) = 6 pages x 3,067                      = 18,402
//   initiatives       ceil(60 / 50)  = 2 pages x 3,062                      =  6,124
//   reference data    5 types, one page each at fixture sizes               =  1,310
//   full bootstrap    13 requests                                           = 25,836
//
// That is 0.3% of the hourly requests and 1.3% of the hourly complexity, and the largest
// query (a projects page) is 31% of the single-query cap. A workspace ten times the
// fixture stays under 20% of the complexity budget, so a re-run (MIRROR-R10) or a
// reconcile in the same hour has room. Labels come as the scalar `labelIds`, not a
// connection. Nested connections are capped at 25 or 50 entries; an entity with more (a
// project in over 25 teams) is truncated there and needs its own follow-up page.
//
// A reconcile pass (../mirror/reconcile.ts, reconcilePlan below) lists the reference data
// in full like the bootstrap, projects and initiatives changed since the last pass with
// the bootstrap's node shapes, and the ids of every project and initiative, 250 a page,
// to find removals. For the fixture workspace with up to 50 changed projects and 50
// changed initiatives since the last pass:
//
//   reference data    5 requests, as above                                  =  1,310
//   changed           1 projects page + 1 initiatives page                  =  6,129
//   id page           250 x (1 + 2 x 0.1) + 1.2, rounded up                 =    302
//   ids               ceil(300 / 250) + ceil(60 / 250) = 3 pages x 302      =    906
//   one pass          10 requests                                           =  8,345
//
// The app token is persisted (app-token-store.ts), so a pass costs no token request. Every
// ten minutes that is 60 requests and about 50,000 points an hour: 1.2% and 2.5% of the
// budget, leaving the rest to webhooks' follow-ups, the sign-in and a bootstrap.

export const appActorHourlyBudget = {
  requests: 5_000,
  complexity: 2_000_000,
  maxQueryComplexity: 10_000,
} as const;

/** The shape of a selected object: its scalar fields, nested objects and connections. */
export type Selection = {
  fields: number;
  objects?: Selection[];
  connections?: { first: number; node: Selection }[];
};

/** Points of one object of this shape, before rounding. */
export function objectComplexity(selection: Selection): number {
  const nested = (selection.objects ?? []).reduce((sum, o) => sum + objectComplexity(o), 0);
  const connections = (selection.connections ?? []).reduce(
    (sum, c) => sum + c.first * objectComplexity(c.node),
    0,
  );
  return 1 + selection.fields * 0.1 + nested + connections;
}

/** `pageInfo { hasNextPage endCursor }` on every paged query. */
const pageInfo: Selection = { fields: 2 };

/** Points Linear charges for one page of `pageSize` nodes of this shape. */
export function pageComplexity(pageSize: number, node: Selection): number {
  // Round in tenths first so 0.1-point sums do not round up on floating-point noise.
  const points = Math.round((pageSize * objectComplexity(node) + objectComplexity(pageInfo)) * 10);
  return Math.ceil(points / 10);
}

const id: Selection = { fields: 1 };
const latestUpdate: Selection = { fields: 4 }; // id, body, health, createdAt

export type EntityPlan = { pageSize: number; node: Selection };

/**
 * Page sizes and selections of the bootstrap, one entry per listed entity type
 * (MIRROR-R9). The query texts are in ../mirror/listing.ts; the budget test parses them
 * and checks they select exactly these shapes. Initiative statuses are a fixed enum in
 * Linear's schema and cost no request.
 */
export const bootstrapPlan = {
  // id name slugId identifier url startDate targetDate priority health progress
  // createdAt updatedAt archivedAt completedAt canceledAt trashed labelIds
  projects: {
    pageSize: 50,
    node: {
      fields: 17,
      objects: [id, id, latestUpdate], // lead, status, lastUpdate
      connections: [
        { first: 25, node: id }, // teams
        { first: 25, node: id }, // initiatives
      ],
    },
  },
  // id name slugId identifier url status targetDate priority health createdAt updatedAt
  // archivedAt completedAt trashed visibility labelIds
  initiatives: {
    pageSize: 50,
    node: {
      fields: 16,
      objects: [id, id, latestUpdate], // owner, leadTeam, lastUpdate
      connections: [{ first: 50, node: id }], // projects
    },
  },
  // id name key displayName private archivedAt updatedAt, parent
  teams: { pageSize: 100, node: { fields: 7, objects: [id] } },
  // id name displayName email avatarUrl active archivedAt updatedAt
  users: { pageSize: 100, node: { fields: 8 } },
  // id name type color position archivedAt updatedAt
  projectStatuses: { pageSize: 100, node: { fields: 7 } },
  // id name color isGroup groupType archivedAt updatedAt, parent, team
  projectLabels: { pageSize: 100, node: { fields: 7, objects: [id, id] } },
  // id name color isGroup groupType archivedAt updatedAt, parent
  initiativeLabels: { pageSize: 100, node: { fields: 7, objects: [id] } },
} satisfies Record<string, EntityPlan>;

export type EntityType = keyof typeof bootstrapPlan;

export type BootstrapEstimate = {
  requests: number;
  complexity: number;
  /** The most expensive single query. */
  maxQueryComplexity: number;
};

/** Requests and points of listing each plan through `count` nodes. */
function estimatePages(pages: readonly (readonly [EntityPlan, number])[]): BootstrapEstimate {
  let requests = 0;
  let complexity = 0;
  let maxQueryComplexity = 0;
  for (const [{ pageSize, node }, count] of pages) {
    // An empty listing still costs the one request that finds it empty.
    const n = Math.max(1, Math.ceil(count / pageSize));
    const perPage = pageComplexity(pageSize, node);
    requests += n;
    complexity += n * perPage;
    maxQueryComplexity = Math.max(maxQueryComplexity, perPage);
  }
  return { requests, complexity, maxQueryComplexity };
}

/** Requests and points a bootstrap of a workspace with these entity counts costs. */
export function estimateBootstrap(
  counts: Record<EntityType, number>,
  plan: Record<EntityType, EntityPlan> = bootstrapPlan,
): BootstrapEstimate {
  return estimatePages(
    (Object.entries(plan) as [EntityType, EntityPlan][]).map(([type, p]) => [p, counts[type]]),
  );
}

/**
 * Page sizes and selections of the reconcile pass's own queries (MIRROR-R13); its
 * reference data is listed with bootstrapPlan. The query texts are reconcileQueries in
 * ../mirror/listing.ts; the budget test checks they select exactly these shapes.
 */
export const reconcilePlan = {
  changedProjects: bootstrapPlan.projects,
  changedInitiatives: bootstrapPlan.initiatives,
  // id trashed
  projectIds: { pageSize: 250, node: { fields: 2 } },
  initiativeIds: { pageSize: 250, node: { fields: 2 } },
} satisfies Record<string, EntityPlan>;

/** The reference data a reconcile pass lists in full: Linear sends no webhook for it. */
export const referenceTypes = [
  "teams",
  "users",
  "projectStatuses",
  "projectLabels",
  "initiativeLabels",
] as const satisfies readonly EntityType[];

/** Requests and points one reconcile pass costs, given entity counts and what changed. */
export function estimateReconcile(
  counts: Record<EntityType, number>,
  changed: { projects: number; initiatives: number },
): BootstrapEstimate {
  return estimatePages([
    ...referenceTypes.map((type) => [bootstrapPlan[type], counts[type]] as const),
    [reconcilePlan.changedProjects, changed.projects],
    [reconcilePlan.changedInitiatives, changed.initiatives],
    [reconcilePlan.projectIds, counts.projects],
    [reconcilePlan.initiativeIds, counts.initiatives],
  ]);
}
