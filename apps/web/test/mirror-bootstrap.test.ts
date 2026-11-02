// The bootstrap against a fake Linear workspace and a real Postgres (MIRROR-R9,
// MIRROR-R10, MIRROR-R12, MIRROR-R14).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSql, type Sql } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { migrations } from "../src/server/db/migrations.ts";
import { bootstrapPlan } from "../src/server/linear/budget.ts";
import { createAppLinearClient } from "../src/server/linear/client.ts";
import { bootstrap } from "../src/server/mirror/bootstrap.ts";
import { excerpt } from "../src/server/mirror/listing.ts";
import { listMirrored, mirrorIsEmpty, syncStatus } from "../src/server/mirror/read.ts";
import { tables } from "../src/server/mirror/tables.ts";
import { mirrorTypes } from "../src/server/mirror/types.ts";
import { initiativeScopeMessage, json, manualClock } from "./linear-fakes.ts";
import {
  appEnv,
  fakeLinear,
  fixtureWorkspace,
  project,
  type Workspace,
} from "./mirror-fixtures.ts";
import type { ScratchDatabase } from "./scratch-db.ts";
import { scratchDatabase } from "./test-db.ts";

let db: ScratchDatabase;
let sql: Sql;

beforeAll(async () => {
  db = await scratchDatabase("mirror_bootstrap");
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

const clock = manualClock(Date.UTC(2026, 10, 2, 9));

function run(workspace: Workspace, options: Parameters<typeof fakeLinear>[1] = {}) {
  clock.advance(60_000);
  const linear = fakeLinear(workspace, options);
  const client = createAppLinearClient(appEnv, {
    fetch: linear.fetch,
    now: clock.now,
    sleep: clock.sleep,
  });
  return { linear, result: bootstrap({ sql, client, now: clock.now }) };
}

/** Every row of every mirror table, removed ones included, keyed by type. */
async function snapshot() {
  const entries = await Promise.all(
    mirrorTypes.map(async (type) => [
      type,
      await listMirrored(sql, type, { includeRemoved: true }),
    ]),
  );
  return Object.fromEntries(entries);
}

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

describe("bootstrap", () => {
  it("MIRROR-R10 fills an empty mirror with every entity type", async () => {
    expect(await mirrorIsEmpty(sql)).toBe(true);
    const { result } = run(fixtureWorkspace());
    const { counts, changed } = await result;

    expect(await mirrorIsEmpty(sql)).toBe(false);
    expect(ids(await listMirrored(sql, "teams"))).toEqual(["team-ops", "team-test", "team-test-a"]);
    expect(ids(await listMirrored(sql, "users"))).toEqual(["user-ana", "user-ben"]);
    expect(ids(await listMirrored(sql, "projectStatuses"))).toHaveLength(3);
    expect((await listMirrored(sql, "initiativeStatuses")).map((s) => s.id).sort()).toEqual([
      "Active",
      "Canceled",
      "Completed",
      "Planned",
      "Proposed",
    ]);
    expect(ids(await listMirrored(sql, "projectLabels"))).toEqual([
      "plabel-bet",
      "plabel-size",
      "plabel-size-s",
      "plabel-test-only",
      "plabel-theme",
    ]);
    expect(ids(await listMirrored(sql, "initiativeLabels"))).toHaveLength(3);
    expect(ids(await listMirrored(sql, "projects"))).toEqual(["p1", "p2", "p3"]);
    expect(ids(await listMirrored(sql, "initiatives"))).toEqual(["i1", "i2"]);

    expect(counts.projects).toEqual({
      inserted: 3,
      updated: 0,
      unchanged: 0,
      removed: 0,
      dropped: 2,
    });
    expect(counts.teams.dropped).toBe(2);
    expect(changed).toBe(3 + 2 + 3 + 5 + 5 + 3 + 3 + 2);
  });

  it("MIRROR-R9 mirrors the fields of section 4 from the listing", async () => {
    await run(fixtureWorkspace()).result;
    const [p1] = await listMirrored(sql, "projects").then((rows) =>
      rows.filter((p) => p.id === "p1"),
    );
    expect(p1).toMatchObject({
      name: "Project p1",
      slugId: "p1-slug",
      identifier: "P-TST-p1",
      url: "https://linear.app/sesv/project/p1-slug",
      statusId: "status-started",
      leadId: "user-ana",
      startDate: "2026-10-01",
      targetDate: "2026-12-31",
      priority: 2,
      health: "onTrack",
      progress: 0.25,
      teamIds: ["team-test"],
      initiativeIds: ["i1"],
      labelIds: ["plabel-size-s", "plabel-bet"],
      lastUpdate: {
        id: "pu-1",
        excerpt: "Shipped the first milestone.",
        health: "onTrack",
        createdAt: "2026-10-04T00:00:00.000Z",
      },
      updatedAt: "2026-10-02T00:00:00.000Z",
      archivedAt: null,
      removedAt: null,
      syncedSource: "bootstrap",
    });

    const [i1] = (await listMirrored(sql, "initiatives")).filter((i) => i.id === "i1");
    expect(i1).toMatchObject({
      name: "Initiative i1",
      identifier: "I-i1",
      status: "Active",
      ownerId: "user-ben",
      leadTeamId: "team-test",
      targetDate: "2027-03-31",
      priority: 1,
      labelIds: ["ilabel-horizon-h1"],
      lastUpdate: { id: "iu-1", excerpt: "On track." },
    });

    const teams = await listMirrored(sql, "teams");
    expect(teams.find((t) => t.id === "team-test-a")).toMatchObject({
      parentId: "team-test",
      private: false,
    });
    expect(teams.find((t) => t.id === "team-ops")?.archivedAt).toBe("2026-10-03T00:00:00.000Z");
    expect((await listMirrored(sql, "projects")).find((p) => p.id === "p3")?.archivedAt).toBe(
      "2026-10-05T00:00:00.000Z",
    );

    const groups = (await listMirrored(sql, "projectLabels")).filter((l) => l.isGroup);
    // A group without a type is single-select in Linear; P1 shows one column per such group.
    expect(groups.map((g) => [g.id, g.selection])).toEqual([
      ["plabel-size", "single"],
      ["plabel-theme", "multi"],
    ]);
    const size = (await listMirrored(sql, "projectLabels")).find((l) => l.id === "plabel-size-s");
    expect(size).toMatchObject({ parentId: "plabel-size", isGroup: false, selection: null });
  });

  it("MIRROR-R10 pages through every listed type with the budgeted page sizes", async () => {
    const workspace = fixtureWorkspace();
    const { linear, result } = run(workspace);
    await result;
    const queries = linear.queries();
    const byType = new Map<string, { first: unknown; after: unknown }[]>();
    for (const { query, variables } of queries) {
      const type = /\{\s*(\w+)\(/.exec(query)?.[1] ?? "";
      byType.set(type, [
        ...(byType.get(type) ?? []),
        { first: variables.first, after: variables.after },
      ]);
    }
    expect([...byType.keys()].sort()).toEqual(Object.keys(bootstrapPlan).sort());
    for (const [type, pages] of byType) {
      const plan = bootstrapPlan[type as keyof typeof bootstrapPlan];
      expect(pages.length, type).toBe(
        Math.max(1, Math.ceil(workspace[type as keyof Workspace].length / 2)),
      );
      expect(pages[0], type).toEqual({ first: plan.pageSize, after: null });
      pages.slice(1).forEach((page, i) => {
        expect(page.after, type).toBe(String((i + 1) * 2));
      });
    }
    // Reference data before the projects and initiatives that refer to it.
    const order = [...byType.keys()];
    expect(order.indexOf("teams")).toBe(0);
    expect(order.slice(-2)).toEqual(["projects", "initiatives"]);
  });

  it("MIRROR-R10 a second run on an unchanged workspace changes nothing", async () => {
    const workspace = fixtureWorkspace();
    await run(workspace).result;
    const before = await snapshot();

    const second = await run(workspace).result;
    expect(second.changed).toBe(0);
    for (const type of mirrorTypes) {
      expect(second.counts[type].inserted + second.counts[type].updated, type).toBe(0);
      expect(second.counts[type].removed, type).toBe(0);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("MIRROR-R10 a second run applies only the entities that changed in Linear", async () => {
    const workspace = fixtureWorkspace();
    await run(workspace).result;
    const before = await snapshot();

    workspace.projects[0] = {
      ...workspace.projects[0],
      name: "Renamed",
      updatedAt: "2026-10-20T00:00:00.000Z",
    };
    // A payload no newer than the mirror is not applied, whatever it says.
    workspace.initiatives[1] = { ...workspace.initiatives[1], name: "Stale rename" };
    const second = await run(workspace).result;

    expect(second.changed).toBe(1);
    expect(second.counts.projects).toMatchObject({ inserted: 0, updated: 1, unchanged: 2 });
    const after = await snapshot();
    const p1 = after.projects.find((p: { id: string }) => p.id === "p1");
    expect(p1).toMatchObject({ name: "Renamed", updatedAt: "2026-10-20T00:00:00.000Z" });
    expect(p1.syncSeq).toBeGreaterThan(
      before.projects.find((p: { id: string }) => p.id === "p1").syncSeq,
    );
    expect(after.initiatives.find((i: { id: string }) => i.id === "i2").name).toBe("Initiative i2");
    expect(after.projects.filter((p: { id: string }) => p.id !== "p1")).toEqual(
      before.projects.filter((p: { id: string }) => p.id !== "p1"),
    );
    for (const type of mirrorTypes.filter((t) => t !== "projects")) {
      expect(after[type], type).toEqual(before[type]);
    }
  });

  it("MIRROR-R10 flags an entity Linear no longer returns as removed, and keeps the row", async () => {
    const workspace = fixtureWorkspace();
    await run(workspace).result;

    const gone = workspace.projects.splice(1, 1); // p2
    workspace.projectLabels = workspace.projectLabels.filter((l) => l.id !== "plabel-bet");
    // A type Linear now returns empty for: every row of it is flagged.
    workspace.initiativeLabels = [];
    const second = await run(workspace).result;
    expect(second.counts.projects.removed).toBe(1);
    expect(second.counts.projectLabels.removed).toBe(1);
    expect(second.counts.initiativeLabels.removed).toBe(3);
    expect(await listMirrored(sql, "initiativeLabels")).toEqual([]);

    expect(ids(await listMirrored(sql, "projects"))).toEqual(["p1", "p3"]);
    const all = await listMirrored(sql, "projects", { includeRemoved: true });
    const p2 = all.find((p) => p.id === "p2");
    expect(p2?.removedAt).toBe(new Date(clock.now()).toISOString());
    expect(p2?.name).toBe("Project p2");
    expect(await sql`select count(*)::int as n from mirror_projects`).toEqual([{ n: 3 }]);

    // Linear returns it again: the flag clears.
    workspace.projects.push(...gone);
    const third = await run(workspace).result;
    expect(third.counts.projects).toMatchObject({ updated: 1, removed: 0 });
    expect(ids(await listMirrored(sql, "projects"))).toEqual(["p1", "p2", "p3"]);
  });

  it("MIRROR-R10 treats a trashed project as no longer returned", async () => {
    const workspace = fixtureWorkspace();
    await run(workspace).result;
    workspace.projects[0] = { ...workspace.projects[0], trashed: true };
    await run(workspace).result;
    expect(ids(await listMirrored(sql, "projects"))).toEqual(["p2", "p3"]);
  });

  it("MIRROR-R12 never writes a private team, nor a project or initiative only in private teams", async () => {
    const workspace = fixtureWorkspace();
    await run(workspace).result;

    for (const type of mirrorTypes) {
      const rows = await listMirrored(sql, type, { includeRemoved: true });
      expect(
        rows.filter((row) => row.id.includes("sbx")),
        type,
      ).toEqual([]);
    }
    const projects = await listMirrored(sql, "projects");
    // In a public and a private team: kept, with the private team stripped.
    expect(projects.find((p) => p.id === "p2")?.teamIds).toEqual(["team-test-a"]);
    for (const p of projects) expect(p.teamIds.join()).not.toContain("sbx");
    for (const i of await listMirrored(sql, "initiatives"))
      expect(i.leadTeamId ?? "").not.toContain("sbx");
    const dump = await sql`
      select row_to_json(t)::text as row from mirror_teams t
      union all select row_to_json(l)::text from mirror_project_labels l
    `;
    expect(dump.map((r) => r.row).join("\n")).not.toContain("sbx");
  });

  it("MIRROR-R12 a project whose only public team turns private is flagged removed and not updated", async () => {
    const workspace = fixtureWorkspace();
    await run(workspace).result;
    workspace.projects.push(project("p5", ["team-test-a"]));
    await run(workspace).result;

    workspace.teams = workspace.teams.map((t) =>
      t.id === "team-test-a" ? { ...t, private: true } : t,
    );
    workspace.projects = workspace.projects.map((p) =>
      p.id === "p5" ? { ...p, name: "Secret name", updatedAt: "2026-10-25T00:00:00.000Z" } : p,
    );
    const third = await run(workspace).result;
    expect(third.counts.teams.removed).toBe(1);
    const p5 = (await listMirrored(sql, "projects", { includeRemoved: true })).find(
      (p) => p.id === "p5",
    );
    expect(p5?.removedAt).not.toBeNull();
    expect(p5?.name).toBe("Project p5");
    // p2 was in that team and a private one, so it has no public team left either.
    expect(ids(await listMirrored(sql, "projects"))).toEqual(["p1", "p3"]);
  });

  it("MIRROR-R14 records the run in the sync log and reports when the mirror last changed", async () => {
    const workspace = fixtureWorkspace();
    const first = await run(workspace).result;
    let status = await syncStatus(sql);
    expect(status.bootstrap).toEqual({
      lastRunAt: first.finishedAt.toISOString(),
      lastOutcome: "ok",
      lastOkStartedAt: first.startedAt.toISOString(),
      lastOkAt: first.finishedAt.toISOString(),
    });
    expect(status.lastChangeAt).toBe(first.finishedAt.toISOString());
    expect(status.webhook.lastRunAt).toBeNull();
    expect(status.reconcile.lastRunAt).toBeNull();

    // A run that changes nothing still counts as a run, but not as a change.
    const second = await run(workspace).result;
    status = await syncStatus(sql);
    expect(status.bootstrap.lastRunAt).toBe(second.finishedAt.toISOString());
    expect(status.lastChangeAt).toBe(first.finishedAt.toISOString());

    const [entry] = await sql`select * from mirror_sync_log order by id limit 1`;
    expect(entry).toMatchObject({ source: "bootstrap", outcome: "ok", changed: first.changed });
    expect(entry?.counts.projects).toEqual(first.counts.projects);
  });

  it("MIRROR-R2 MIRROR-R10 the app token carries the scope Linear asks for initiatives", async () => {
    // The fake refuses initiatives as Linear does; every bootstrap above got through it.
    const { linear, result } = run(fixtureWorkspace());
    await result;
    const tokenRequest = linear.calls.find((call) => call.url.endsWith("/oauth/token"));
    expect(new URLSearchParams(String(tokenRequest?.init.body)).get("scope")).toContain(
      "initiative:read",
    );
    expect(ids(await listMirrored(sql, "initiatives"))).not.toHaveLength(0);

    // Without it, the bootstrap fails the way the scheduler did against Linear.
    const readOnly = fakeLinear(fixtureWorkspace());
    const client = createAppLinearClient(appEnv, {
      fetch: ((input, init = {}) =>
        readOnly.fetch(
          input,
          String(input).endsWith("/oauth/token")
            ? { ...init, body: "grant_type=client_credentials&scope=read,write" }
            : init,
        )) as typeof globalThis.fetch,
      now: clock.now,
      sleep: clock.sleep,
    });
    await expect(bootstrap({ sql, client, now: clock.now })).rejects.toThrow(
      `Linear API HTTP 400: ${initiativeScopeMessage}`,
    );
  });

  it("MIRROR-R10 a failed listing writes nothing and is logged as failed", async () => {
    const workspace = fixtureWorkspace();
    await run(workspace).result;
    const before = await snapshot();

    workspace.projects = [];
    const failing = run(workspace, {
      fail: (type) =>
        type === "initiatives"
          ? json({ errors: [{ message: "boom", extensions: { code: "INTERNAL" } }] })
          : undefined,
    });
    await expect(failing.result).rejects.toThrow(/boom/);
    expect(await snapshot()).toEqual(before);
    const status = await syncStatus(sql);
    expect(status.bootstrap.lastOutcome).toBe("failed");
    const [failed] = await sql`select * from mirror_sync_log where outcome = 'failed'`;
    expect(failed?.error).toMatch(/boom/);
  });
});

describe("excerpt", () => {
  it("MIRROR-R9 collapses whitespace and shortens a long update", () => {
    expect(excerpt("  a\n\nb  ")).toBe("a b");
    const long = excerpt("word ".repeat(200));
    expect(long.length).toBeLessThanOrEqual(280);
    expect(long.endsWith("…")).toBe(true);
  });
});
