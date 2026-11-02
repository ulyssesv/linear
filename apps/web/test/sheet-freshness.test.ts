// Freshness of an open sheet (MIRROR-R24): the change marker, what the server sends a poll,
// how the page merges it, and the polling loop. The browser path, a webhook and a
// reconcile-style write reaching an open sheet, is in e2e/sheet-behaviours.spec.ts.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSql, type Sql } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { migrations } from "../src/server/db/migrations.ts";
import { applyRecords, markRemoved, recordSyncRun } from "../src/server/mirror/apply.ts";
import {
  initiativeFromNode,
  projectFromNode,
  projectStatusFromNode,
  teamFromNode,
  userFromNode,
} from "../src/server/mirror/listing.ts";
import { changedTypes, mirrorFreshness } from "../src/server/mirror/read.ts";
import { loadSheetView, sheetChanges, sheetChangesFor } from "../src/server/sheets/load.ts";
import {
  applyChange,
  parseSheetChangesInput,
  relativeTime,
  type SheetFreshness,
} from "../src/sheets/freshness.ts";
import type { SheetModel, SheetRow } from "../src/sheets/model.ts";
import { startPolling, type VisibilitySource } from "../src/sheets/poller.ts";
import { fixtureWorkspace, project } from "./mirror-fixtures.ts";
import type { ScratchDatabase } from "./scratch-db.ts";
import { scratchDatabase } from "./test-db.ts";

const row = (id: string, name = id, flags: SheetRow["flags"] = []): SheetRow => ({
  id,
  flags,
  cells: { name },
});
const model = (rows: SheetRow[]): SheetModel => ({
  kind: "projects",
  columns: [{ id: "name", title: "Name", shape: "text" }],
  rows,
});

describe("merging a change into a sheet", () => {
  it("MIRROR-R24 replaces changed rows in place, keeps the rest, and adds new ones", () => {
    const before = model([row("a"), row("b"), row("c")]);
    const after = applyChange(before, {
      type: "rows",
      rows: [row("b", "B renamed"), row("d"), row("c", "c", ["archived"])],
    });
    expect(after.rows.map((r) => [r.id, r.cells.name, r.flags])).toEqual([
      ["a", "a", []],
      ["b", "B renamed", []],
      ["c", "c", ["archived"]],
      ["d", "d", []],
    ]);
    expect(after.rows[0]).toBe(before.rows[0]);
    expect(before.rows[1]?.cells.name).toBe("b");
  });

  it("MIRROR-R24 replaces the whole sheet on a full change and keeps it on none", () => {
    const before = model([row("a")]);
    const replacement = model([row("z")]);
    expect(applyChange(before, { type: "full", model: replacement })).toBe(replacement);
    expect(applyChange(before, null)).toBe(before);
    expect(applyChange(before, { type: "rows", rows: [] })).toBe(before);
  });

  it("MIRROR-R24 accepts only a known sheet and non-negative integer markers from the browser", () => {
    expect(parseSheetChangesInput({ kind: "projects", version: 3, bulkRun: 0 })).toEqual({
      kind: "projects",
      version: 3,
      bulkRun: 0,
    });
    for (const bad of [
      { kind: "issues", version: 1, bulkRun: 0 },
      { kind: "projects", version: -1, bulkRun: 0 },
      { kind: "projects", version: 1.5, bulkRun: 0 },
      { kind: "projects", version: "1", bulkRun: 0 },
      null,
    ]) {
      expect(() => parseSheetChangesInput(bad)).toThrow();
    }
  });

  it("MIRROR-R24 says how long ago the mirror changed", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    expect(relativeTime("2026-11-02T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-11-02T11:58:00Z", now)).toBe("2 minutes ago");
    expect(relativeTime("2026-11-02T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-11-01T11:00:00Z", now)).toBe("yesterday");
  });
});

describe("the polling loop", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeVisibility(initial: DocumentVisibilityState = "visible") {
    const target = new EventTarget();
    const source = {
      visibilityState: initial,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      set(state: DocumentVisibilityState) {
        source.visibilityState = state;
        target.dispatchEvent(new Event("visibilitychange"));
      },
    };
    return source as typeof source & VisibilitySource;
  }

  it("MIRROR-R24 polls on the interval while visible, one request at a time", async () => {
    vi.useFakeTimers();
    let resolve: (() => void) | undefined;
    const poll = vi.fn(() => new Promise<number>((r) => (resolve = () => r(1))));
    const onResult = vi.fn(() => true);
    const stop = startPolling({
      intervalMs: 3000,
      poll,
      onResult,
      onError: () => {},
      visibility: fakeVisibility(),
    });
    expect(poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll).toHaveBeenCalledTimes(1);
    // A slow answer holds the next request back.
    await vi.advanceTimersByTimeAsync(9000);
    expect(poll).toHaveBeenCalledTimes(1);
    resolve?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
  });

  it("MIRROR-R24 pauses while hidden and asks at once when visible again", async () => {
    vi.useFakeTimers();
    const visibility = fakeVisibility();
    const poll = vi.fn(async () => 1);
    const stop = startPolling({
      intervalMs: 3000,
      poll,
      onResult: () => true,
      onError: () => {},
      visibility,
    });
    visibility.set("hidden");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).not.toHaveBeenCalled();
    visibility.set("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("MIRROR-R24 stops for good when told to, and carries on after a failure", async () => {
    vi.useFakeTimers();
    const results = [new Error("offline"), "signed-out"];
    const poll = vi.fn(async () => {
      const next = results.shift();
      if (next instanceof Error) throw next;
      return next;
    });
    const onError = vi.fn();
    const onResult = vi.fn(() => false);
    startPolling({ intervalMs: 1000, poll, onResult, onError, visibility: fakeVisibility() });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onResult).toHaveBeenCalledWith("signed-out");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });
});

describe("changes since a marker", () => {
  let db: ScratchDatabase;
  let sql: Sql;
  const user = { id: "user-1", name: "Ana", email: "ana@example.com" };
  let tick = 0;
  /** A strictly later Linear time for each write, so every upsert applies. */
  const later = () => new Date(Date.UTC(2026, 10, 1, 0, 0, ++tick)).toISOString();
  const webhook = () => ({ source: "webhook" as const, at: new Date() });

  async function writeProject(id: string, options: Record<string, unknown> = {}) {
    const record = projectFromNode(project(id, ["team-test"], { updatedAt: later(), ...options }));
    await applyRecords(sql, "projects", [record], webhook());
    await recordSyncRun(sql, {
      source: "webhook",
      startedAt: new Date(),
      finishedAt: new Date(),
      outcome: "ok",
      changed: 1,
    });
  }

  const marker = (f: SheetFreshness, kind: "projects" | "initiatives" = "projects") => ({
    kind,
    version: f.version,
    bulkRun: f.bulkRun,
  });

  beforeAll(async () => {
    db = await scratchDatabase("sheet_freshness");
    sql = createSql(db.url, { max: 2 });
    await migrate(sql, migrations);
    const workspace = fixtureWorkspace();
    const context = { source: "bootstrap" as const, at: new Date("2026-11-02T10:00:00Z") };
    const publicOnly = <T extends { id: string }>(records: T[]) =>
      records.filter((record) => !record.id.includes("sbx"));
    await applyRecords(sql, "teams", publicOnly(workspace.teams.map(teamFromNode)), context);
    await applyRecords(sql, "users", workspace.users.map(userFromNode), context);
    await applyRecords(
      sql,
      "projectStatuses",
      workspace.projectStatuses.map(projectStatusFromNode),
      context,
    );
    await applyRecords(
      sql,
      "projects",
      publicOnly(workspace.projects.map(projectFromNode)),
      context,
    );
    await applyRecords(
      sql,
      "initiatives",
      publicOnly(workspace.initiatives.map(initiativeFromNode)),
      context,
    );
    await recordSyncRun(sql, {
      source: "bootstrap",
      startedAt: context.at,
      finishedAt: context.at,
      outcome: "ok",
      changed: 10,
    });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await db?.drop();
  });

  it("MIRROR-R24 reports the mirror's version, latest bulk run and last change", async () => {
    const freshness = await mirrorFreshness(sql);
    expect(freshness.version).toBeGreaterThan(0);
    expect(freshness.bulkRun).toBeGreaterThan(0);
    expect(freshness.lastChangeAt).toBe("2026-11-02T10:00:00.000Z");
    expect(await changedTypes(sql, freshness.version)).toEqual([]);
    expect(await changedTypes(sql, 0)).toEqual([
      "teams",
      "users",
      "projectStatuses",
      "projects",
      "initiatives",
    ]);
  });

  it("MIRROR-R24 loads a sheet with the marker read before it", async () => {
    const view = await loadSheetView(sql, "projects");
    expect(view.freshness).toEqual(await mirrorFreshness(sql));
    expect(view.model.rows.map((r) => r.id)).toContain("p1");
  });

  it("MIRROR-R24 sends nothing while the mirror has not moved", async () => {
    const freshness = await mirrorFreshness(sql);
    expect(await sheetChanges(sql, marker(freshness))).toEqual({ freshness, change: null });
  });

  it("MIRROR-R24 sends only the changed and new rows of the sheet's own entities", async () => {
    const before = await mirrorFreshness(sql);
    await writeProject("p1", { name: "Project p1 renamed" });
    await writeProject("p9");
    const result = await sheetChanges(sql, marker(before));
    expect(result.freshness.version).toBeGreaterThan(before.version);
    expect(result.freshness.lastChangeAt).not.toBe(before.lastChangeAt);
    expect(result.change?.type).toBe("rows");
    if (result.change?.type !== "rows") return;
    expect(result.change.rows.map((r) => [r.id, r.cells.name])).toEqual([
      ["p1", "Project p1 renamed"],
      ["p9", "Project p9"],
    ]);
    // Reference data was read in full to build them.
    expect(result.change.rows[0]?.cells.lead).toEqual({ name: "Ana" });
  });

  it("MIRROR-R24 sends a removal as the row with its flag", async () => {
    const before = await mirrorFreshness(sql);
    await markRemoved(sql, "projects", ["p9"], webhook());
    const result = await sheetChanges(sql, marker(before));
    expect(result.change).toEqual({
      type: "rows",
      rows: [expect.objectContaining({ id: "p9", flags: ["removed"] })],
    });
  });

  it("MIRROR-R24 sends the whole sheet when reference data changed", async () => {
    const before = await mirrorFreshness(sql);
    const [ana] = fixtureWorkspace().users.map(userFromNode);
    if (!ana) throw new Error("fixture user missing");
    await applyRecords(sql, "users", [{ ...ana, name: "Ana B", updatedAt: later() }], webhook());
    const result = await sheetChanges(sql, marker(before));
    expect(result.change?.type).toBe("full");
    if (result.change?.type !== "full") return;
    const p1 = result.change.model.rows.find((r) => r.id === "p1");
    expect(p1?.cells.lead).toEqual({ name: "Ana B" });
  });

  it("MIRROR-R24 sends the initiatives sheet in full when a project changed", async () => {
    const before = await mirrorFreshness(sql);
    await writeProject("p2");
    const result = await sheetChanges(sql, marker(before, "initiatives"));
    expect(result.change?.type).toBe("full");
  });

  it("MIRROR-R24 sends the whole sheet after a bulk run, even with no version change seen", async () => {
    const before = await mirrorFreshness(sql);
    // A reconcile pass that committed rows below a version the client already holds.
    await recordSyncRun(sql, {
      source: "reconcile",
      startedAt: new Date(),
      finishedAt: new Date(),
      outcome: "ok",
      changed: 3,
    });
    const result = await sheetChanges(sql, marker(before));
    expect(result.freshness.bulkRun).toBeGreaterThan(before.bulkRun);
    expect(result.change?.type).toBe("full");
    // A reconcile pass that changed nothing moves no marker.
    const after = result.freshness;
    await recordSyncRun(sql, {
      source: "reconcile",
      startedAt: new Date(),
      finishedAt: new Date(),
      outcome: "ok",
      changed: 0,
    });
    expect((await sheetChanges(sql, marker(after))).change).toBeNull();
  });

  it("MIRROR-R15 MIRROR-R24 tells a poll without a session to sign in, reading nothing", async () => {
    const freshness = await mirrorFreshness(sql);
    expect(await sheetChangesFor(null, sql, marker(freshness))).toEqual({ signedIn: false });
    expect(await sheetChangesFor(user, sql, marker(freshness))).toEqual({
      signedIn: true,
      freshness,
      change: null,
    });
  });
});
