// Loading a sheet from the mirror (MIRROR-R18) and refusing anyone without a session
// (MIRROR-R15): the server function behind each sheet calls loadSheetFor.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql, type Sql } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { migrations } from "../src/server/db/migrations.ts";
import { applyRecords, markRemoved } from "../src/server/mirror/apply.ts";
import {
  initiativeFromNode,
  initiativeLabelFromNode,
  projectFromNode,
  projectLabelFromNode,
  projectStatusFromNode,
  teamFromNode,
  userFromNode,
} from "../src/server/mirror/listing.ts";
import { loadSheetFor, NotSignedInError } from "../src/server/sheets/load.ts";
import { fixtureWorkspace } from "./mirror-fixtures.ts";
import type { ScratchDatabase } from "./scratch-db.ts";
import { scratchDatabase } from "./test-db.ts";

let db: ScratchDatabase;
let sql: Sql;
const user = { id: "user-1", name: "Ana", email: "ana@example.com" };

beforeAll(async () => {
  db = await scratchDatabase("sheet_load");
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
    "projectLabels",
    publicOnly(workspace.projectLabels.map(projectLabelFromNode)),
    context,
  );
  await applyRecords(
    sql,
    "initiativeLabels",
    workspace.initiativeLabels.map(initiativeLabelFromNode),
    context,
  );
  await applyRecords(sql, "projects", publicOnly(workspace.projects.map(projectFromNode)), context);
  await applyRecords(
    sql,
    "initiatives",
    publicOnly(workspace.initiatives.map(initiativeFromNode)),
    context,
  );
  await markRemoved(sql, "projects", ["p4"], context);
});

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await db?.drop();
});

describe("loading a sheet", () => {
  it("MIRROR-R15 refuses a request without a signed-in user", async () => {
    await expect(loadSheetFor(null, sql, "projects")).rejects.toBeInstanceOf(NotSignedInError);
    await expect(loadSheetFor(null, sql, "initiatives")).rejects.toBeInstanceOf(NotSignedInError);
  });

  it("MIRROR-R18 lists every mirrored project, removed and archived ones flagged", async () => {
    const model = await loadSheetFor(user, sql, "projects");
    expect(model.kind).toBe("projects");
    const flags = Object.fromEntries(model.rows.map((row) => [row.id, row.flags]));
    expect(flags).toEqual({ p1: [], p2: [], p3: ["archived"], p4: ["removed"] });
    const p1 = model.rows.find((row) => row.id === "p1");
    expect(p1?.cells.lead).toEqual({ name: "Ana" });
    expect(p1?.cells.status).toEqual({ label: "In progress", color: "#888888" });
    expect(p1?.cells.initiatives).toEqual([{ label: "Initiative i1", color: null }]);
    expect(model.columns.map((column) => column.title)).toContain("Size");
  });

  it("MIRROR-R18 lists every mirrored initiative with its project count", async () => {
    const model = await loadSheetFor(user, sql, "initiatives");
    expect(model.kind).toBe("initiatives");
    const i1 = model.rows.find((row) => row.id === "i1");
    // p1 is mirrored; sbx-p1 never is.
    expect(i1?.cells.projects).toBe(1);
    expect(i1?.cells["label:ilabel-horizon"]).toEqual({ label: "H1", color: "#eb5757" });
  });
});
