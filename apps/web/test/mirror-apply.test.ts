// The mirror's write and read modules against a real Postgres (MIRROR-R9, MIRROR-R10,
// MIRROR-R12, MIRROR-R14). These are the functions the webhook receiver (T4) and the
// reconcile pass (T5) call.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSql, type Sql } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { migrations } from "../src/server/db/migrations.ts";
import {
  applyRecords,
  markMissingRemoved,
  markRemoved,
  recordSyncRun,
} from "../src/server/mirror/apply.ts";
import {
  initiativeFromNode,
  projectFromNode,
  teamFromNode,
  userFromNode,
} from "../src/server/mirror/listing.ts";
import { getMirrored, listMirrored, publicTeamIds, syncStatus } from "../src/server/mirror/read.ts";
import { scopeInitiative } from "../src/server/mirror/scope.ts";
import { tables } from "../src/server/mirror/tables.ts";
import { type MirrorRecords, type MirrorType, mirrorTypes } from "../src/server/mirror/types.ts";
import { fixtureWorkspace, initiative, project } from "./mirror-fixtures.ts";
import type { ScratchDatabase } from "./scratch-db.ts";
import { scratchDatabase } from "./test-db.ts";

let db: ScratchDatabase;
let sql: Sql;

beforeAll(async () => {
  db = await scratchDatabase("mirror_apply");
  sql = createSql(db.url, { max: 2 });
  await migrate(sql, migrations);
});

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await db?.drop();
});

beforeEach(async () => {
  const names = [...mirrorTypes.map((type) => tables[type].table), "mirror_sync_log"];
  await sql.unsafe(`truncate ${names.join(", ")}`);
});

const t0 = new Date("2026-11-02T10:00:00.000Z");
const later = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const webhook = (at: Date) => ({ source: "webhook" as const, at });
const workspace = fixtureWorkspace();

/** One record of every type, as a feeder would hand them over. */
const samples: { [T in MirrorType]: MirrorRecords[T] } = {
  teams: teamFromNode(workspace.teams[0] ?? {}),
  users: userFromNode(workspace.users[0] ?? {}),
  projectStatuses: {
    id: "status-x",
    name: "Started",
    type: "started",
    color: "#f2c94c",
    position: 1.5,
    updatedAt: "2026-10-01T00:00:00.000Z",
    archivedAt: null,
  },
  initiativeStatuses: {
    id: "Active",
    name: "Active",
    position: 2,
    updatedAt: "2026-11-02T00:00:00.000Z",
    archivedAt: null,
  },
  projectLabels: {
    id: "label-x",
    name: "Size",
    color: "#000000",
    isGroup: true,
    selection: "single",
    parentId: null,
    teamId: "team-test",
    updatedAt: "2026-10-01T00:00:00.000Z",
    archivedAt: "2026-10-09T00:00:00.000Z",
  },
  initiativeLabels: {
    id: "ilabel-x",
    name: "H1",
    color: "#ffffff",
    isGroup: false,
    selection: null,
    parentId: "ilabel-group",
    updatedAt: "2026-10-01T00:00:00.000Z",
    archivedAt: null,
  },
  projects: projectFromNode(
    project("p1", ["team-test"], {
      labelIds: ["label-x"],
      lastUpdate: {
        id: "u1",
        body: "Fine.",
        health: "atRisk",
        createdAt: "2026-10-04T00:00:00.000Z",
      },
    }),
  ),
  initiatives: (() => {
    const { visibility: _, ...record } = initiativeFromNode(initiative("i1", "team-test"));
    return record;
  })(),
};

describe("applyRecords", () => {
  it("MIRROR-R9 stores every entity type with its fields, updatedAt and archived state", async () => {
    for (const type of mirrorTypes) {
      const counts = await applyRecords(sql, type, [samples[type]], webhook(t0));
      expect(counts, type).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
      const [row] = await listMirrored(sql, type);
      expect(row, type).toEqual({
        ...samples[type],
        removedAt: null,
        syncedAt: t0.toISOString(),
        syncedSource: "webhook",
        syncSeq: expect.any(Number),
      });
    }
  });

  it("MIRROR-R10 applies a newer payload and ignores one that is not newer", async () => {
    const p1 = samples.projects;
    await applyRecords(sql, "projects", [p1], webhook(t0));
    const first = await getMirrored(sql, "projects", "p1");

    const same = await applyRecords(
      sql,
      "projects",
      [{ ...p1, name: "Same time" }],
      webhook(later(1)),
    );
    const older = await applyRecords(
      sql,
      "projects",
      [{ ...p1, name: "Older", updatedAt: "2026-09-01T00:00:00.000Z" }],
      webhook(later(2)),
    );
    expect([same, older]).toEqual([
      { inserted: 0, updated: 0, unchanged: 1 },
      { inserted: 0, updated: 0, unchanged: 1 },
    ]);
    expect(await getMirrored(sql, "projects", "p1")).toEqual(first);

    const newer = { ...p1, name: "Newer", updatedAt: "2026-10-30T00:00:00.000Z" };
    expect(
      await applyRecords(sql, "projects", [newer], { source: "reconcile", at: later(3) }),
    ).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    const updated = await getMirrored(sql, "projects", "p1");
    expect(updated).toMatchObject({
      name: "Newer",
      syncedSource: "reconcile",
      syncedAt: later(3).toISOString(),
    });
    expect(updated?.syncSeq).toBeGreaterThan(first?.syncSeq ?? Infinity);
  });

  it("MIRROR-R10 keeps the newest of several payloads for one entity in a batch", async () => {
    const p1 = samples.projects;
    const counts = await applyRecords(
      sql,
      "projects",
      [
        { ...p1, name: "B", updatedAt: "2026-10-05T00:00:00.000Z" },
        { ...p1, name: "A", updatedAt: "2026-10-03T00:00:00.000Z" },
      ],
      webhook(t0),
    );
    expect(counts).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
    expect((await getMirrored(sql, "projects", "p1"))?.name).toBe("B");
  });

  it("MIRROR-R12 the database refuses a private team even if a feeder skipped the filter", async () => {
    await expect(
      applyRecords(
        sql,
        "teams",
        [{ ...samples.teams, id: "team-sbx", private: true }],
        webhook(t0),
      ),
    ).rejects.toThrow(/check/);
    await expect(
      applyRecords(sql, "projects", [{ ...samples.projects, teamIds: [] }], webhook(t0)),
    ).rejects.toThrow(/check/);
  });

  it("MIRROR-R12 publicTeamIds gives a webhook the teams to scope against", async () => {
    await applyRecords(
      sql,
      "teams",
      workspace.teams.filter((t) => !String(t.id).includes("sbx")).map(teamFromNode),
      { source: "bootstrap", at: t0 },
    );
    await markRemoved(sql, "teams", ["team-ops"], webhook(later(1)));
    const known = await publicTeamIds(sql);
    expect([...known].sort()).toEqual(["team-test", "team-test-a"]);
    const payload = initiativeFromNode(initiative("i9", "team-ops"));
    expect(scopeInitiative(payload, known)).toBeNull();
  });
});

describe("removal", () => {
  it("MIRROR-R10 markRemoved flags a row without deleting it, and a newer payload revives it", async () => {
    await applyRecords(sql, "projects", [samples.projects], webhook(t0));
    expect(await markRemoved(sql, "projects", ["p1", "unknown"], webhook(later(1)))).toBe(1);
    expect(await markRemoved(sql, "projects", ["p1"], webhook(later(2)))).toBe(0);

    expect(await listMirrored(sql, "projects")).toEqual([]);
    const removed = await getMirrored(sql, "projects", "p1");
    expect(removed).toMatchObject({
      name: samples.projects.name,
      removedAt: later(1).toISOString(),
    });

    // The same version again (a bootstrap after a team turned public again) revives it.
    expect(await applyRecords(sql, "projects", [samples.projects], webhook(later(3)))).toEqual({
      inserted: 0,
      updated: 1,
      unchanged: 0,
    });
    expect((await getMirrored(sql, "projects", "p1"))?.removedAt).toBeNull();
  });

  it("MIRROR-R10 markMissingRemoved spares rows written since the listing started", async () => {
    const p = (id: string) => ({ ...samples.projects, id });
    await applyRecords(sql, "projects", [p("a"), p("b")], { source: "bootstrap", at: t0 });
    // A webhook adds "c" while a listing that started at later(1) is paging.
    await applyRecords(sql, "projects", [p("c")], webhook(later(2)));
    const removed = await markMissingRemoved(sql, "projects", ["a"], {
      source: "bootstrap",
      at: later(3),
      since: later(1),
    });
    expect(removed).toBe(1);
    expect((await listMirrored(sql, "projects")).map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("syncStatus", () => {
  it("MIRROR-R14 reports when the mirror last changed and when each feeder last ran", async () => {
    const empty = await syncStatus(sql);
    expect(empty).toMatchObject({ lastChangeAt: null, version: 0 });
    for (const source of ["bootstrap", "webhook", "reconcile"] as const) {
      expect(empty[source]).toEqual({
        lastRunAt: null,
        lastOutcome: null,
        lastOkStartedAt: null,
        lastOkAt: null,
      });
    }

    await recordSyncRun(sql, {
      source: "bootstrap",
      startedAt: t0,
      finishedAt: later(1),
      outcome: "ok",
      changed: 40,
    });
    await recordSyncRun(sql, {
      source: "webhook",
      startedAt: later(5),
      finishedAt: later(5),
      outcome: "ok",
      changed: 1,
      counts: { projects: { updated: 1 } },
    });
    await recordSyncRun(sql, {
      source: "reconcile",
      startedAt: later(10),
      finishedAt: later(11),
      outcome: "ok",
      changed: 0,
    });
    await recordSyncRun(sql, {
      source: "reconcile",
      startedAt: later(20),
      finishedAt: later(21),
      outcome: "failed",
      changed: 0,
      error: "Linear API HTTP 500",
    });
    await applyRecords(sql, "projects", [samples.projects], webhook(later(5)));

    const status = await syncStatus(sql);
    // The reconcile passes changed nothing, so the last change is the webhook's.
    expect(status.lastChangeAt).toBe(later(5).toISOString());
    expect(status.version).toBeGreaterThan(0);
    expect(status.bootstrap).toEqual({
      lastRunAt: later(1).toISOString(),
      lastOutcome: "ok",
      lastOkStartedAt: t0.toISOString(),
      lastOkAt: later(1).toISOString(),
    });
    expect(status.webhook).toMatchObject({ lastRunAt: later(5).toISOString(), lastOutcome: "ok" });
    expect(status.reconcile).toEqual({
      lastRunAt: later(21).toISOString(),
      lastOutcome: "failed",
      lastOkStartedAt: later(10).toISOString(),
      lastOkAt: later(11).toISOString(),
    });
  });

  it("MIRROR-R14 every written row carries its source and time, and version grows with writes", async () => {
    await applyRecords(sql, "users", [samples.users], { source: "bootstrap", at: t0 });
    const v1 = (await syncStatus(sql)).version;
    await applyRecords(sql, "users", [samples.users], webhook(later(1)));
    expect((await syncStatus(sql)).version).toBe(v1);
    await markRemoved(sql, "users", [samples.users.id], { source: "reconcile", at: later(2) });
    const v2 = (await syncStatus(sql)).version;
    expect(v2).toBeGreaterThan(v1);

    const [user] = await listMirrored(sql, "users", { includeRemoved: true });
    expect(user).toMatchObject({ syncedSource: "reconcile", syncedAt: later(2).toISOString() });
    expect(await listMirrored(sql, "users", { includeRemoved: true, afterSeq: v1 })).toHaveLength(
      1,
    );
    expect(await listMirrored(sql, "users", { includeRemoved: true, afterSeq: v2 })).toEqual([]);
  });
});
