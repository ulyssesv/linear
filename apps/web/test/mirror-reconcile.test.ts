// The reconcile pass and the scheduler against a fake Linear workspace and a real Postgres
// (MIRROR-R13, MIRROR-R14). No test reaches the network.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSql, type Sql } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { migrations } from "../src/server/db/migrations.ts";
import { createAppLinearClient } from "../src/server/linear/client.ts";
import { applyRecords } from "../src/server/mirror/apply.ts";
import { type ListedType, teamFromNode } from "../src/server/mirror/listing.ts";
import { getMirrored, listMirrored, syncStatus } from "../src/server/mirror/read.ts";
import {
  type PassResult,
  reconcileOverlapMs,
  runSyncPass,
  syncPassLockKey,
} from "../src/server/mirror/reconcile.ts";
import { schedulerPass } from "../src/server/mirror/scheduler.ts";
import { tables } from "../src/server/mirror/tables.ts";
import { mirrorTypes } from "../src/server/mirror/types.ts";
import { json, manualClock, type Recorded, tokenResponse } from "./linear-fakes.ts";
import { appEnv, fixtureWorkspace, project, type Workspace } from "./mirror-fixtures.ts";
import type { ScratchDatabase } from "./scratch-db.ts";
import { scratchDatabase } from "./test-db.ts";

let db: ScratchDatabase;
let sql: Sql;

beforeAll(async () => {
  db = await scratchDatabase("mirror_reconcile");
  sql = createSql(db.url, { max: 4 });
  await migrate(sql, migrations);
});

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await db?.drop();
});

const clock = manualClock(Date.UTC(2026, 10, 2, 9));
const minute = 60_000;

beforeEach(async () => {
  const names = [
    ...mirrorTypes.map((type) => tables[type].table),
    "mirror_sync_log",
    "linear_app_token",
  ];
  await sql.unsafe(`truncate ${names.join(", ")}`);
  clock.advance(24 * 60 * minute);
});

type Query = { query: string; variables: Record<string, unknown> };

/**
 * A fetch over `workspace` that honours what the reconcile queries ask Linear for: the
 * `updatedAt >= $since` filter and the page size, two nodes a page so small fixtures page.
 * `hold` blocks every GraphQL answer until it resolves; `fail(type)` replaces one answer.
 */
function fakeLinear(
  workspace: Workspace,
  options: { hold?: Promise<void>; fail?: (type: string) => Response | undefined } = {},
) {
  const calls: Recorded[] = [];
  const queries: Query[] = [];
  let tokens = 0;
  let reached: () => void = () => {};
  const firstQuery = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith("/oauth/token")) {
      tokens++;
      return tokenResponse(`app-token-${tokens}`);
    }
    const body = JSON.parse(String(init.body)) as Query;
    queries.push(body);
    reached();
    await options.hold;
    const type = /\{\s*(\w+)\(/.exec(body.query)?.[1] as ListedType;
    const failure = options.fail?.(type);
    if (failure) return failure;
    const since = body.variables.since;
    const all = (workspace[type] ?? []).filter(
      (node) =>
        typeof since !== "string" || Date.parse(String(node.updatedAt)) >= Date.parse(since),
    );
    const after = body.variables.after;
    const start = typeof after === "string" ? Number(after) : 0;
    const end = Math.min(start + Math.min(2, Number(body.variables.first)), all.length);
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
    queries,
    firstQuery,
    tokenRequests: () => tokens,
    /** Operation names, in order. */
    operations: () => queries.map((q) => /query (\w+)/.exec(q.query)?.[1]),
  };
}

function pass(workspace: Workspace, options: Parameters<typeof fakeLinear>[1] = {}) {
  clock.advance(minute);
  const linear = fakeLinear(workspace, options);
  const client = createAppLinearClient(appEnv, {
    fetch: linear.fetch,
    now: clock.now,
    sleep: clock.sleep,
  });
  return { linear, result: runSyncPass({ sql, client, now: clock.now }) };
}

/** A fresh timestamp after the last pass: Linear changed something just now. */
function justNow(): string {
  clock.advance(minute);
  return new Date(clock.now()).toISOString();
}

function expectOk(result: PassResult): asserts result is Extract<PassResult, { outcome: "ok" }> {
  expect(result.outcome, JSON.stringify(result)).toBe("ok");
}

async function syncLog() {
  return sql`select source, outcome, started_at, changed, error from mirror_sync_log order by id`;
}

describe("sync pass", () => {
  it("MIRROR-R13 bootstraps an empty mirror, then reconciles", async () => {
    const workspace = fixtureWorkspace();
    const first = await pass(workspace).result;
    expectOk(first);
    expect(first.source).toBe("bootstrap");
    expect(first.since).toBeNull();
    expect(ids(await listMirrored(sql, "projects"))).toEqual(["p1", "p2", "p3"]);

    const second = await pass(workspace).result;
    expectOk(second);
    expect(second.source).toBe("reconcile");
    expect(second.changed).toBe(0);
    expect((await syncLog()).map((row) => [row.source, row.outcome])).toEqual([
      ["bootstrap", "ok"],
      ["reconcile", "ok"],
    ]);
  });

  it("MIRROR-R13 bootstraps when the mirror holds only webhook rows and no pass ran yet", async () => {
    await applyRecords(sql, "teams", [teamFromNode(fixtureWorkspace().teams[0] ?? {})], {
      source: "webhook",
      at: new Date(clock.now()),
    });
    const result = await pass(fixtureWorkspace()).result;
    expectOk(result);
    expect(result.source).toBe("bootstrap");
  });

  it("MIRROR-R13 lists projects and initiatives changed since the last successful pass, minus the overlap", async () => {
    const workspace = fixtureWorkspace();
    const boot = await pass(workspace).result;
    expectOk(boot);

    const { linear, result } = pass(workspace);
    const second = await result;
    expectOk(second);
    const since = new Date(boot.startedAt.getTime() - reconcileOverlapMs);
    expect(second.since?.toISOString()).toBe(since.toISOString());
    const changed = linear.queries.filter((q) => /MirrorChanged/.test(q.query));
    expect(changed.map((q) => q.variables.since)).toEqual([
      since.toISOString(),
      since.toISOString(),
    ]);

    // The next window starts from the reconcile that just succeeded.
    const third = await pass(workspace).result;
    expectOk(third);
    expect(third.since?.getTime()).toBe(second.startedAt.getTime() - reconcileOverlapMs);
  });

  it("MIRROR-R13 MIRROR-R14 applies a change whose webhook never arrived, stamped reconcile", async () => {
    const workspace = fixtureWorkspace();
    await pass(workspace).result;
    const changedAt = justNow();
    const p1 = workspace.projects.find((p) => p.id === "p1");
    Object.assign(p1 ?? {}, { name: "Renamed in Linear", updatedAt: changedAt });
    workspace.projects.push(project("p5", ["team-test"], { updatedAt: changedAt }));

    const before = await syncStatus(sql);
    const result = await pass(workspace).result;
    expectOk(result);
    expect(result.counts.projects).toMatchObject({ inserted: 1, updated: 1 });

    const row = await getMirrored(sql, "projects", "p1");
    expect(row).toMatchObject({ name: "Renamed in Linear", syncedSource: "reconcile" });
    expect(row?.syncedAt).toBe(new Date(clock.now()).toISOString());
    expect(await getMirrored(sql, "projects", "p5")).toMatchObject({ syncedSource: "reconcile" });

    const after = await syncStatus(sql);
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.reconcile).toMatchObject({
      lastOutcome: "ok",
      lastRunAt: result.finishedAt.toISOString(),
      lastOkStartedAt: result.startedAt.toISOString(),
    });
    expect(after.lastChangeAt).toBe(result.finishedAt.toISOString());
  });

  it("MIRROR-R13 the overlap catches a change stamped just before the previous pass started", async () => {
    const workspace = fixtureWorkspace();
    const boot = await pass(workspace).result;
    expectOk(boot);
    // Linear's clock runs five minutes behind ours: the change lands after the bootstrap
    // listed projects, with an updatedAt before the bootstrap started.
    const skewed = new Date(boot.startedAt.getTime() - 5 * minute).toISOString();
    workspace.projects.push(project("p6", ["team-test"], { updatedAt: skewed }));

    const result = await pass(workspace).result;
    expectOk(result);
    expect(await getMirrored(sql, "projects", "p6")).toMatchObject({ syncedSource: "reconcile" });
  });

  it("MIRROR-R13 leaves entities that did not change in the window alone", async () => {
    const workspace = fixtureWorkspace();
    await pass(workspace).result;
    const before = await syncStatus(sql);
    const { linear, result } = pass(workspace);
    expectOk(await result);
    // The fixture's projects changed in October, long before the window.
    const changedPages = linear.queries.filter((q) => /MirrorChanged/.test(q.query));
    expect(changedPages).toHaveLength(2);
    expect((await syncStatus(sql)).version).toBe(before.version);
    expect((await getMirrored(sql, "projects", "p1"))?.syncedSource).toBe("bootstrap");
  });

  it("MIRROR-R13 flags deleted and trashed projects and initiatives removed within one pass", async () => {
    const workspace = fixtureWorkspace();
    await pass(workspace).result;
    workspace.projects = workspace.projects.filter((p) => p.id !== "p2");
    const p1 = workspace.projects.find((p) => p.id === "p1");
    // Trashing in Linear may or may not bump updatedAt; removal must not depend on it.
    Object.assign(p1 ?? {}, { trashed: true });
    workspace.initiatives = workspace.initiatives.filter((i) => i.id !== "i2");

    const result = await pass(workspace).result;
    expectOk(result);
    expect(result.counts.projects.removed).toBe(2);
    expect(result.counts.initiatives.removed).toBe(1);
    expect(ids(await listMirrored(sql, "projects"))).toEqual(["p3"]);
    expect(ids(await listMirrored(sql, "initiatives"))).toEqual(["i1"]);
    const removed = await getMirrored(sql, "projects", "p2");
    expect(removed).toMatchObject({ syncedSource: "reconcile" });
    expect(removed?.removedAt).not.toBeNull();

    // Restored from the trash: back with its next change.
    Object.assign(p1 ?? {}, { trashed: null, updatedAt: justNow() });
    expectOk(await pass(workspace).result);
    expect((await getMirrored(sql, "projects", "p1"))?.removedAt).toBeNull();
  });

  it("MIRROR-R13 MIRROR-R12 flags a project removed when it moves to private teams only", async () => {
    const workspace = fixtureWorkspace();
    await pass(workspace).result;
    const p1 = workspace.projects.find((p) => p.id === "p1");
    Object.assign(p1 ?? {}, {
      teams: { nodes: [{ id: "team-sbx" }] },
      updatedAt: justNow(),
      name: "Now private",
    });

    const result = await pass(workspace).result;
    expectOk(result);
    expect(result.counts.projects).toMatchObject({ dropped: 1, removed: 1 });
    const row = await getMirrored(sql, "projects", "p1");
    expect(row?.removedAt).not.toBeNull();
    expect(row?.name).toBe("Project p1");
  });

  it("MIRROR-R13 MIRROR-R12 lists in full when a team leaves scope, so its projects are re-scoped", async () => {
    const workspace = fixtureWorkspace();
    await pass(workspace).result;
    // Test A (a sub-team of Test) is made private; p2 was in Test A and Sandbox.
    const testA = workspace.teams.find((t) => t.id === "team-test-a");
    Object.assign(testA ?? {}, { private: true, updatedAt: justNow() });

    const { linear, result } = pass(workspace);
    const outcome = await result;
    expectOk(outcome);
    expect(outcome.since).toBeNull();
    expect(linear.operations()).toContain("MirrorProjects");
    expect(linear.operations()).not.toContain("MirrorChangedProjects");
    expect((await getMirrored(sql, "teams", "team-test-a"))?.removedAt).not.toBeNull();
    expect((await getMirrored(sql, "projects", "p2"))?.removedAt).not.toBeNull();
    expect((await getMirrored(sql, "projects", "p1"))?.removedAt).toBeNull();

    // With the team gone from the mirror, the next pass is a window again.
    const next = await pass(workspace).result;
    expectOk(next);
    expect(next.since).not.toBeNull();
  });

  it("MIRROR-R13 refreshes the reference data in full every pass", async () => {
    const workspace = fixtureWorkspace();
    await pass(workspace).result;
    const ana = workspace.users.find((u) => u.id === "user-ana");
    Object.assign(ana ?? {}, { name: "Ana Maria", updatedAt: justNow() });
    workspace.projectLabels = workspace.projectLabels.filter((l) => l.id !== "plabel-bet");
    workspace.projectStatuses.push({
      id: "status-paused",
      name: "Paused",
      type: "paused",
      color: "#888888",
      position: 3,
      archivedAt: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await pass(workspace).result;
    expectOk(result);
    expect(result.counts.users.updated).toBe(1);
    expect(result.counts.projectLabels.removed).toBe(1);
    expect(result.counts.projectStatuses.inserted).toBe(1);
    expect((await getMirrored(sql, "users", "user-ana"))?.name).toBe("Ana Maria");
    expect(await getMirrored(sql, "projectStatuses", "status-paused")).toMatchObject({
      syncedSource: "reconcile",
    });
  });

  it("MIRROR-R13 MIRROR-R14 a failed pass changes nothing, is recorded, and the next window ignores it", async () => {
    const workspace = fixtureWorkspace();
    const boot = await pass(workspace).result;
    expectOk(boot);
    workspace.projects.push(project("p7", ["team-test"], { updatedAt: justNow() }));
    const before = await syncStatus(sql);

    const failed = await pass(workspace, {
      fail: (type) =>
        type === "initiatives"
          ? json({ errors: [{ message: "boom" }] }, { status: 500 })
          : undefined,
    }).result;
    expect(failed).toMatchObject({ outcome: "failed", source: "reconcile" });
    expect(failed.outcome === "failed" && failed.error).toMatch(/HTTP 500: boom/);
    expect(await getMirrored(sql, "projects", "p7")).toBeNull();
    const after = await syncStatus(sql);
    expect(after.version).toBe(before.version);
    expect(after.reconcile).toMatchObject({ lastOutcome: "failed", lastOkStartedAt: null });
    expect((await syncLog()).at(-1)).toMatchObject({ source: "reconcile", outcome: "failed" });

    const retried = await pass(workspace).result;
    expectOk(retried);
    expect(retried.since?.getTime()).toBe(boot.startedAt.getTime() - reconcileOverlapMs);
    expect(await getMirrored(sql, "projects", "p7")).not.toBeNull();
  });

  it("MIRROR-R13 a failed bootstrap is reported with its source", async () => {
    const failed = await pass(fixtureWorkspace(), {
      fail: (type) => (type === "users" ? json({}, { status: 502 }) : undefined),
    }).result;
    expect(failed).toMatchObject({ outcome: "failed", source: "bootstrap" });
    expect((await syncLog()).map((row) => [row.source, row.outcome])).toEqual([
      ["bootstrap", "failed"],
    ]);
  });

  it("MIRROR-R13 skips without touching Linear while another pass holds the lock", async () => {
    const holder = await sql.reserve();
    try {
      await holder`select pg_advisory_lock(${syncPassLockKey})`;
      const { linear, result } = pass(fixtureWorkspace());
      expect(await result).toEqual({ outcome: "skipped", reason: "another pass is running" });
      expect(linear.calls).toHaveLength(0);
      expect(await syncLog()).toHaveLength(0);
    } finally {
      await holder`select pg_advisory_unlock(${syncPassLockKey})`;
      holder.release();
    }
  });

  it("MIRROR-R13 two passes at once: one runs, the other skips, the mirror is consistent", async () => {
    const workspace = fixtureWorkspace();
    let open: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      open = resolve;
    });
    const first = pass(workspace, { hold });
    await first.linear.firstQuery;
    const second = pass(workspace);
    expect(await second.result).toMatchObject({ outcome: "skipped" });
    open();
    const done = await first.result;
    expectOk(done);
    expect(ids(await listMirrored(sql, "projects"))).toEqual(["p1", "p2", "p3"]);
    // The lock is released: the next pass runs.
    expectOk(await pass(workspace).result);
  });
});

describe("scheduler", () => {
  const env = () => ({
    DATABASE_URL: db.url,
    ...appEnv,
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });

  it("MIRROR-R13 runs a pass and reuses one app token across runs, stored encrypted", async () => {
    const workspace = fixtureWorkspace();
    const linear = fakeLinear(workspace);
    const options = { fetch: linear.fetch, now: clock.now, sleep: clock.sleep };

    clock.advance(minute);
    const first = await schedulerPass(env(), options);
    expect(first).toMatchObject({ outcome: "ok", source: "bootstrap" });
    expect(first.linear.requests).toBe(linear.queries.length);
    clock.advance(10 * minute);
    const second = await schedulerPass(env(), options);
    expect(second).toMatchObject({ outcome: "ok", source: "reconcile" });

    expect(linear.tokenRequests()).toBe(1);
    const auth = linear.calls
      .filter((call) => call.url.endsWith("/graphql"))
      .map((call) => new Headers(call.init.headers).get("authorization"));
    expect(new Set(auth)).toEqual(new Set(["Bearer app-token-1"]));
    const [row] = await sql`select access_token from linear_app_token`;
    expect(String(row?.access_token)).toMatch(/^v1:/);
    expect(String(row?.access_token)).not.toContain("app-token-1");
  });

  it("MIRROR-R13 talks to the API origin LINEAR_API_URL names, for tests and the smoke only", async () => {
    const linear = fakeLinear(fixtureWorkspace());
    clock.advance(minute);
    await schedulerPass(
      { ...env(), LINEAR_API_URL: "http://linear-stub:8080" },
      { fetch: linear.fetch, now: clock.now, sleep: clock.sleep },
    );
    expect(new Set(linear.calls.map((call) => new URL(call.url).origin))).toEqual(
      new Set(["http://linear-stub:8080"]),
    );
  });

  it("MIRROR-R11 MIRROR-R13 prunes webhook delivery ids older than a week after an ok pass", async () => {
    const linear = fakeLinear(fixtureWorkspace());
    clock.advance(minute);
    const day = 24 * 60 * minute;
    await sql`delete from webhook_deliveries`;
    await sql`
      insert into webhook_deliveries (delivery_id, received_at, type, action, outcome)
      values
        ('old', ${new Date(clock.now() - 8 * day)}, 'Project', 'update', 'applied'),
        ('recent', ${new Date(clock.now() - 6 * day)}, 'Project', 'update', 'applied')
    `;
    const result = await schedulerPass(env(), { fetch: linear.fetch, now: clock.now });
    expect(result).toMatchObject({ outcome: "ok", prunedDeliveries: 1 });
    const left = await sql`select delivery_id from webhook_deliveries`;
    expect(left.map((row) => row.delivery_id)).toEqual(["recent"]);
  });

  it("MIRROR-R13 reports a failed pass without throwing", async () => {
    const linear = fakeLinear(fixtureWorkspace(), {
      fail: () => json({ errors: [{ message: "down" }] }, { status: 503 }),
    });
    clock.advance(minute);
    const result = await schedulerPass(env(), { fetch: linear.fetch, now: clock.now });
    expect(result).toMatchObject({ outcome: "failed", source: "bootstrap" });
    expect(result.outcome === "failed" && result.error).toMatch(/HTTP 503: down/);
  });
});

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();
