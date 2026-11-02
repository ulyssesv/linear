// Mirror data for end-to-end tests of the sheets. Records are written into the database the
// `local` server reads through applyRecords and markRemoved, the sync code's own writers,
// and deleted after each test. Ids and names carry a random suffix so tests running
// side by side, in this checkout or another, never see each other's rows by mistake.
// Names start with "000" so they sort first and render without scrolling.
//
//   import { expect, test } from "./mirror.ts";
//   test("...", async ({ page, signIn, mirror }) => {
//     const { id, name } = mirror;               // unique per test
//     await mirror.write({ projects: [mirror.project("p1", { name: name("Plan") })] });
//   });
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { applyRecords, markRemoved } from "../src/server/mirror/apply.ts";
import { tables } from "../src/server/mirror/tables.ts";
import {
  type Initiative,
  type InitiativeLabel,
  type MirrorRecords,
  type MirrorType,
  mirrorTypes,
  type Project,
  type ProjectLabel,
  type ProjectStatus,
  type Team,
  type User,
} from "../src/server/mirror/types.ts";
import { test as base } from "./auth.ts";
import { e2eDatabaseUrl } from "./server-env.ts";

const at = "2026-10-01T00:00:00.000Z";
const tracked = { updatedAt: at, archivedAt: null };

export type MirrorWrite = { [T in MirrorType]?: MirrorRecords[T][] } & {
  /** Entities to flag removed after writing, as a webhook remove event would. */
  removed?: { [T in MirrorType]?: string[] };
};

export type E2EMirror = {
  /** A unique id for this test: `e2e-<suffix>-<local>`. */
  id(local: string): string;
  /** A unique name for this test that sorts first: `000 <suffix> <local>`. */
  name(local: string): string;
  write(records: MirrorWrite): Promise<void>;
  team(local: string, options?: Partial<Team>): Team;
  user(local: string, options?: Partial<User>): User;
  projectStatus(local: string, options?: Partial<ProjectStatus>): ProjectStatus;
  projectLabel(local: string, options?: Partial<ProjectLabel>): ProjectLabel;
  initiativeLabel(local: string, options?: Partial<InitiativeLabel>): InitiativeLabel;
  project(local: string, options?: Partial<Project>): Project;
  initiative(local: string, options?: Partial<Initiative>): Initiative;
};

function createMirror(written: Map<MirrorType, Set<string>>): E2EMirror {
  const suffix = randomBytes(4).toString("hex");
  const id = (local: string) => `e2e-${suffix}-${local}`;
  const name = (local: string) => `000 ${suffix} ${local}`;
  // Every project needs a team; projects that name none get this one, written with them.
  const defaultTeamId = id("team");
  const mirror: E2EMirror = {
    id,
    name,
    async write(input) {
      const records = { ...input };
      const needsTeam = records.projects?.some((p) => p.teamIds.includes(defaultTeamId));
      if (needsTeam && !written.get("teams")?.has(defaultTeamId)) {
        records.teams = [mirror.team("team"), ...(records.teams ?? [])];
      }
      const sql = postgres(e2eDatabaseUrl, { max: 1, onnotice: () => {} });
      const context = { source: "bootstrap" as const, at: new Date() };
      try {
        for (const type of mirrorTypes) {
          const list = records[type] as MirrorRecords[typeof type][] | undefined;
          if (!list?.length) continue;
          const ids = written.get(type) ?? new Set<string>();
          for (const record of list) ids.add(record.id);
          written.set(type, ids);
          await applyRecords(sql, type, list, context);
        }
        for (const [type, ids] of Object.entries(records.removed ?? {})) {
          await markRemoved(sql, type as MirrorType, ids ?? [], context);
        }
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
    team: (local, options = {}) => ({
      ...tracked,
      id: id(local),
      name: name(local),
      key: local.toUpperCase().slice(0, 5),
      displayName: name(local),
      parentId: null,
      private: false,
      ...options,
    }),
    user: (local, options = {}) => ({
      ...tracked,
      id: id(local),
      name: name(local),
      displayName: local,
      email: `${id(local)}@example.com`,
      avatarUrl: null,
      active: true,
      ...options,
    }),
    projectStatus: (local, options = {}) => ({
      ...tracked,
      id: id(local),
      name: name(local),
      type: "started",
      color: "#f2c94c",
      position: 1,
      ...options,
    }),
    projectLabel: (local, options = {}) => ({
      ...tracked,
      id: id(local),
      name: name(local),
      color: "#5e6ad2",
      isGroup: false,
      selection: null,
      parentId: null,
      teamId: null,
      ...options,
    }),
    initiativeLabel: (local, options = {}) => ({
      ...tracked,
      id: id(local),
      name: name(local),
      color: "#5e6ad2",
      isGroup: false,
      selection: null,
      parentId: null,
      ...options,
    }),
    project: (local, options = {}) => ({
      ...tracked,
      id: id(local),
      name: name(local),
      slugId: `${id(local)}-slug`,
      identifier: null,
      url: `https://linear.app/sesv/project/${id(local)}-slug`,
      statusId: null,
      leadId: null,
      startDate: null,
      targetDate: null,
      priority: 0,
      health: null,
      progress: 0,
      teamIds: [defaultTeamId],
      initiativeIds: [],
      labelIds: [],
      lastUpdate: null,
      createdAt: at,
      completedAt: null,
      canceledAt: null,
      ...options,
    }),
    initiative: (local, options = {}) => ({
      ...tracked,
      id: id(local),
      name: name(local),
      slugId: `${id(local)}-slug`,
      identifier: null,
      url: `https://linear.app/sesv/initiative/${id(local)}-slug`,
      status: "Planned",
      ownerId: null,
      leadTeamId: null,
      targetDate: null,
      priority: 0,
      health: null,
      projectIds: [],
      labelIds: [],
      lastUpdate: null,
      createdAt: at,
      completedAt: null,
      ...options,
    }),
  };
  return mirror;
}

/** Deletes what a test wrote. Test cleanup only; the server never deletes mirror rows. */
async function removeWritten(written: Map<MirrorType, Set<string>>): Promise<void> {
  if (written.size === 0) return;
  const sql = postgres(e2eDatabaseUrl, { max: 1, onnotice: () => {} });
  try {
    for (const [type, ids] of written) {
      await sql`delete from ${sql(tables[type].table)} where id = any(${[...ids]})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Playwright's `test` with `signIn` (auth.ts) and a `mirror` that cleans up after itself. */
export const test = base.extend<{ mirror: E2EMirror }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures take an object pattern
  mirror: async ({}, use) => {
    const written = new Map<MirrorType, Set<string>>();
    await use(createMirror(written));
    await removeWritten(written);
  },
});

export { expect } from "./auth.ts";
