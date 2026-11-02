// The webhook receiver against a real Postgres (MIRROR-R11, MIRROR-R12, MIRROR-R14):
// verification, deduplication, the response budget, and every followed event type and
// action applied to the mirror. Deliveries are recorded-shape payloads (webhook-fixtures.ts);
// nothing reaches the network.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSql, type Sql } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { migrations } from "../src/server/db/migrations.ts";
import { applyRecords } from "../src/server/mirror/apply.ts";
import { initiativeFromNode, projectFromNode, teamFromNode } from "../src/server/mirror/listing.ts";
import { getMirrored, syncStatus } from "../src/server/mirror/read.ts";
import { scopeInitiative, scopeTeams } from "../src/server/mirror/scope.ts";
import { tables } from "../src/server/mirror/tables.ts";
import { mirrorTypes } from "../src/server/mirror/types.ts";
import {
  pruneDeliveries,
  type ReceiveOptions,
  receiveLinearWebhook,
  responseBudgetMs,
} from "../src/server/webhooks/receive.ts";
import { fixtureWorkspace, initiative, project } from "./mirror-fixtures.ts";
import type { ScratchDatabase } from "./scratch-db.ts";
import { scratchDatabase } from "./test-db.ts";
import {
  delivery,
  deliveryId,
  envelope,
  initiativeData,
  initiativeUpdateData,
  type Payload,
  projectData,
  projectUpdateData,
  sentAt,
  webhookSecret,
} from "./webhook-fixtures.ts";

let db: ScratchDatabase;
let sql: Sql;

beforeAll(async () => {
  db = await scratchDatabase("webhooks");
  sql = createSql(db.url, { max: 4 });
  await migrate(sql, migrations);
});

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await db?.drop();
});

const bootstrapAt = new Date("2026-11-02T08:00:00.000Z");

/** A mirror as a bootstrap leaves it: the fixture's public teams, p1, p2 and i1. */
beforeEach(async () => {
  const names = [...mirrorTypes.map((type) => tables[type].table), "mirror_sync_log"];
  await sql.unsafe(`truncate ${names.join(", ")}, webhook_deliveries`);
  const workspace = fixtureWorkspace();
  const context = { source: "bootstrap" as const, at: bootstrapAt };
  await applyRecords(sql, "teams", scopeTeams(workspace.teams.map(teamFromNode)), context);
  await applyRecords(
    sql,
    "projects",
    [
      projectFromNode(
        project("p1", ["team-test"], {
          progress: 0.5,
          initiatives: { nodes: [{ id: "i1" }] },
          lastUpdate: {
            id: "pu-1",
            body: "First update.",
            health: "onTrack",
            createdAt: "2026-11-01T09:00:00.000Z",
          },
        }),
      ),
      projectFromNode(project("p2", ["team-test-a"])),
    ],
    context,
  );
  const i1 = scopeInitiative(
    initiativeFromNode(
      initiative("i1", "team-test", {
        lastUpdate: {
          id: "iu-1",
          body: "On track.",
          health: "onTrack",
          createdAt: "2026-11-01T09:00:00.000Z",
        },
      }),
    ),
    new Set(["team-test"]),
  );
  await applyRecords(sql, "initiatives", i1 ? [i1] : [], context);
});

type Logged = Record<string, unknown>;

function receiver(overrides: Partial<ReceiveOptions> = {}) {
  const lines: Logged[] = [];
  const raw: string[] = [];
  const receive = (request: Request) =>
    receiveLinearWebhook(request, {
      database: () => sql,
      secret: webhookSecret,
      now: () => sentAt + 2_000,
      log: (line) => {
        raw.push(line);
        lines.push(JSON.parse(line) as Logged);
      },
      ...overrides,
    });
  return { receive, lines, raw };
}

async function count(table: string): Promise<number> {
  const [row] = await sql.unsafe(`select count(*)::int as n from ${table}`);
  return Number(row?.n);
}

const send = (body: Payload, options?: Parameters<typeof delivery>[1]) =>
  receiver().receive(delivery(body, options));

describe("verification", () => {
  it("MIRROR-R11 rejects an unsigned delivery with 401 and writes nothing", async () => {
    const { receive, lines } = receiver();
    const body = envelope("Project", "create", projectData("p9"));
    const response = await receive(delivery(body, { signature: null }));
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("unauthorized");
    expect(lines[0]).toMatchObject({ outcome: "unauthorized", status: 401 });
    expect(await getMirrored(sql, "projects", "p9")).toBeNull();
    expect(await count("webhook_deliveries")).toBe(0);
    expect(await count("mirror_sync_log")).toBe(0);
  });

  it("MIRROR-R11 rejects a delivery signed with another secret or altered after signing", async () => {
    const body = envelope("Project", "create", projectData("p9"));
    expect((await send(body, { secret: "not-the-secret" })).status).toBe(401);
    const signed = delivery(body);
    const tampered = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: JSON.stringify(envelope("Project", "create", projectData("p9", { name: "Evil" }))),
    });
    expect((await receiver().receive(tampered)).status).toBe(401);
    expect(await getMirrored(sql, "projects", "p9")).toBeNull();
  });

  it("MIRROR-R11 rejects a correctly signed delivery older than a minute (a replay)", async () => {
    const { receive, lines } = receiver({ now: () => sentAt + 61_000 });
    const response = await receive(delivery(envelope("Project", "create", projectData("p9"))));
    expect(response.status).toBe(401);
    expect(lines[0]).toMatchObject({ outcome: "stale" });
    expect(await getMirrored(sql, "projects", "p9")).toBeNull();
  });

  it("MIRROR-R11 answers 400 to a signed body that is not a webhook envelope", async () => {
    expect((await receiver().receive(delivery("{not json"))).status).toBe(400);
    expect((await send({ hello: "world" })).status).toBe(400);
    const noId = envelope("Project", "create", projectData("p9", { id: undefined }));
    expect((await send(noId)).status).toBe(400);
    expect(await count("webhook_deliveries")).toBe(0);
  });

  it("MIRROR-R11 answers 400 without a delivery id and 413 to an oversized body", async () => {
    const body = envelope("Project", "create", projectData("p9"));
    expect((await send(body, { delivery: null })).status).toBe(400);
    const small = receiver({ maxBodyBytes: 100 });
    expect((await small.receive(delivery(body))).status).toBe(413);
  });

  it("MIRROR-R11 refuses every delivery while no signing secret is configured", async () => {
    const { receive } = receiver({ secret: undefined });
    const response = await receive(delivery(envelope("Project", "create", projectData("p9"))));
    expect(response.status).toBe(500);
    expect(await getMirrored(sql, "projects", "p9")).toBeNull();
  });
});

describe("deduplication and response budget", () => {
  it("MIRROR-R11 ignores a delivery it has already applied", async () => {
    const id = deliveryId();
    const body = envelope("Project", "update", projectData("p1", { name: "Renamed" }));
    const first = receiver();
    expect((await first.receive(delivery(body, { delivery: id }))).status).toBe(200);
    const before = await getMirrored(sql, "projects", "p1");

    const again = receiver({ now: () => sentAt + 30_000 });
    const response = await again.receive(delivery(body, { delivery: id }));
    expect(response.status).toBe(200);
    expect(again.lines[0]).toMatchObject({ outcome: "duplicate", delivery: id });
    expect(await getMirrored(sql, "projects", "p1")).toEqual(before);
    expect(await count("webhook_deliveries")).toBe(1);
    expect(await count("mirror_sync_log")).toBe(1);
  });

  it("MIRROR-R11 applies concurrent copies of one delivery once", async () => {
    const id = deliveryId();
    const body = envelope("Project", "create", projectData("p9"));
    const responses = await Promise.all(
      [0, 1, 2].map(() => receiver().receive(delivery(body, { delivery: id }))),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await count("mirror_sync_log")).toBe(1);
  });

  it("MIRROR-R11 answers a delivery well within Linear's five seconds", async () => {
    const started = performance.now();
    const response = await send(envelope("Project", "create", projectData("p9")));
    expect(response.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(responseBudgetMs).toBeLessThan(5_000);
  });

  it("MIRROR-R11 answers 500 within its budget when the database is stuck, and Linear's retry applies it", async () => {
    const id = deliveryId();
    const body = envelope("Project", "create", projectData("p9"));
    const blocker = createSql(db.url, { max: 1 });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((ready) => {
      void blocker.begin(async (tx) => {
        await tx`lock table webhook_deliveries in access exclusive mode`;
        ready();
        await held;
      });
    });
    await locked;
    try {
      const { receive, lines } = receiver({ budgetMs: 300 });
      const started = performance.now();
      const response = await receive(delivery(body, { delivery: id }));
      expect(response.status).toBe(500);
      expect(performance.now() - started).toBeLessThan(1_000);
      expect(lines[0]).toMatchObject({ outcome: "timeout", status: 500 });
    } finally {
      release();
      await blocker.end({ timeout: 5 });
    }
    // The stuck attempt may still have committed once the lock went; either way the retry
    // answers 200 and the project is applied exactly once.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const retry = await send(body, { delivery: id });
    expect(retry.status).toBe(200);
    expect(await getMirrored(sql, "projects", "p9")).not.toBeNull();
    expect(await count("webhook_deliveries")).toBe(1);
  });

  it("MIRROR-R11 MIRROR-R14 answers 500 when the database fails, so Linear retries", async () => {
    const broken = createSql("postgres://linear:linear@127.0.0.1:1/linear", { max: 1 });
    try {
      const { receive, lines } = receiver({ database: () => broken });
      const response = await receive(delivery(envelope("Project", "create", projectData("p9"))));
      expect(response.status).toBe(500);
      expect(lines[0]).toMatchObject({ outcome: "failed", status: 500 });
    } finally {
      await broken.end({ timeout: 0 });
    }
  });

  it("MIRROR-R11 prunes delivery records past Linear's retry horizon", async () => {
    await send(envelope("Project", "create", projectData("p9")));
    expect(await pruneDeliveries(sql, new Date(sentAt - 1))).toBe(0);
    expect(await pruneDeliveries(sql, new Date(sentAt + 7 * 24 * 3600_000))).toBe(1);
  });
});

describe("projects", () => {
  it("MIRROR-R11 MIRROR-R14 applies a create, stamped with source webhook and its time", async () => {
    const response = await send(envelope("Project", "create", projectData("p9")));
    expect(response.status).toBe(200);
    const row = await getMirrored(sql, "projects", "p9");
    expect(row).toMatchObject({
      name: "Project p9",
      statusId: "status-started",
      leadId: "user-ben",
      teamIds: ["team-test"],
      initiativeIds: ["i1"],
      progress: 0,
      removedAt: null,
      syncedSource: "webhook",
      syncedAt: new Date(sentAt + 2_000).toISOString(),
    });
  });

  it("MIRROR-R11 applies an update and keeps what the payload lacks", async () => {
    const data = projectData("p1", {
      name: "Renamed",
      health: "offTrack",
      lastUpdateId: "pu-1",
      teamIds: ["team-test", "team-ops"],
    });
    const body = envelope("Project", "update", data, { updatedFrom: { name: "Project p1" } });
    expect((await send(body)).status).toBe(200);
    expect(await getMirrored(sql, "projects", "p1")).toMatchObject({
      name: "Renamed",
      health: "offTrack",
      teamIds: ["team-test", "team-ops"],
      progress: 0.5,
      lastUpdate: { id: "pu-1", excerpt: "First update." },
      syncedSource: "webhook",
    });
  });

  it("MIRROR-R11 leaves the row alone for an update older than the mirror", async () => {
    const before = await getMirrored(sql, "projects", "p1");
    const stale = projectData("p1", { name: "Old", updatedAt: "2026-10-01T00:00:00.000Z" });
    expect((await send(envelope("Project", "update", stale))).status).toBe(200);
    expect(await getMirrored(sql, "projects", "p1")).toEqual(before);
  });

  it("MIRROR-R11 flags a removed project, and a trashed one, as removed without deleting", async () => {
    expect((await send(envelope("Project", "remove", projectData("p1")))).status).toBe(200);
    expect((await getMirrored(sql, "projects", "p1"))?.removedAt).toBe(
      new Date(sentAt + 2_000).toISOString(),
    );
    const trashed = projectData("p2", { trashed: true });
    expect((await send(envelope("Project", "update", trashed))).status).toBe(200);
    expect((await getMirrored(sql, "projects", "p2"))?.removedAt).not.toBeNull();
  });

  it("MIRROR-R11 stores archivedAt from an archive update", async () => {
    const archived = projectData("p1", { archivedAt: "2026-11-02T11:00:00.000Z" });
    await send(envelope("Project", "update", archived));
    expect(await getMirrored(sql, "projects", "p1")).toMatchObject({
      archivedAt: "2026-11-02T11:00:00.000Z",
      removedAt: null,
    });
  });
});

describe("initiatives", () => {
  it("MIRROR-R11 applies an initiative create, update and remove", async () => {
    expect((await send(envelope("Initiative", "create", initiativeData("i9")))).status).toBe(200);
    expect(await getMirrored(sql, "initiatives", "i9")).toMatchObject({
      name: "Initiative i9",
      ownerId: "user-ben",
      leadTeamId: "team-test",
      projectIds: ["p1"],
      syncedSource: "webhook",
    });

    const renamed = initiativeData("i9", {
      name: "Renamed",
      status: "Completed",
      updatedAt: "2026-11-02T11:30:00.000Z",
    });
    await send(envelope("Initiative", "update", renamed));
    expect(await getMirrored(sql, "initiatives", "i9")).toMatchObject({
      name: "Renamed",
      status: "Completed",
    });

    await send(envelope("Initiative", "remove", { id: "i9" }));
    expect((await getMirrored(sql, "initiatives", "i9"))?.removedAt).not.toBeNull();
  });

  it("MIRROR-R11 keeps the stored latest update on an initiative update", async () => {
    const data = initiativeData("i1", {
      lastUpdateId: "iu-1",
      lastUpdate: {
        id: "iu-1",
        bodyData: "{}",
        editedAt: "2026-11-01T09:00:00.000Z",
        health: "onTrack",
      },
    });
    await send(envelope("Initiative", "update", data));
    expect((await getMirrored(sql, "initiatives", "i1"))?.lastUpdate).toMatchObject({
      id: "iu-1",
      excerpt: "On track.",
    });
  });
});

describe("project and initiative updates", () => {
  it("MIRROR-R11 sets a project's latest update from a ProjectUpdate create", async () => {
    const before = await getMirrored(sql, "projects", "p1");
    const response = await send(
      envelope("ProjectUpdate", "create", projectUpdateData("pu-2", "p1")),
    );
    expect(response.status).toBe(200);
    const after = await getMirrored(sql, "projects", "p1");
    expect(after?.lastUpdate).toEqual({
      id: "pu-2",
      excerpt: "We are **on track**. Next: the beta.",
      health: "onTrack",
      createdAt: "2026-11-02T09:00:00.000Z",
    });
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(after?.syncedSource).toBe("webhook");
    expect(after?.syncSeq).toBeGreaterThan(before?.syncSeq ?? 0);
  });

  it("MIRROR-R11 applies an edit of the latest update and ignores an older one", async () => {
    const edited = projectUpdateData("pu-1", "p1", {
      body: "First update, edited.",
      createdAt: "2026-11-01T09:00:00.000Z",
      health: "atRisk",
    });
    await send(envelope("ProjectUpdate", "update", edited));
    expect((await getMirrored(sql, "projects", "p1"))?.lastUpdate).toMatchObject({
      id: "pu-1",
      excerpt: "First update, edited.",
      health: "atRisk",
    });

    const older = projectUpdateData("pu-0", "p1", { createdAt: "2026-10-01T00:00:00.000Z" });
    const before = await getMirrored(sql, "projects", "p1");
    await send(envelope("ProjectUpdate", "create", older));
    expect(await getMirrored(sql, "projects", "p1")).toEqual(before);
  });

  it("MIRROR-R11 clears the latest update when it is removed or archived", async () => {
    await send(envelope("ProjectUpdate", "remove", projectUpdateData("pu-0", "p1")));
    expect((await getMirrored(sql, "projects", "p1"))?.lastUpdate?.id).toBe("pu-1");
    await send(envelope("ProjectUpdate", "remove", projectUpdateData("pu-1", "p1")));
    expect((await getMirrored(sql, "projects", "p1"))?.lastUpdate).toBeNull();

    const archived = initiativeUpdateData("iu-1", "i1", { archivedAt: "2026-11-02T10:00:00.000Z" });
    await send(envelope("InitiativeUpdate", "update", archived));
    expect((await getMirrored(sql, "initiatives", "i1"))?.lastUpdate).toBeNull();
  });

  it("MIRROR-R11 sets an initiative's latest update from an InitiativeUpdate create", async () => {
    await send(envelope("InitiativeUpdate", "create", initiativeUpdateData("iu-2", "i1")));
    expect((await getMirrored(sql, "initiatives", "i1"))?.lastUpdate).toMatchObject({
      id: "iu-2",
      excerpt: "We are **on track**. Next: the beta.",
    });
  });
});

describe("scope", () => {
  it("MIRROR-R12 drops a project in private teams only before any write", async () => {
    const { receive, lines } = receiver();
    const body = envelope("Project", "create", projectData("sbx-p9", { teamIds: ["team-sbx"] }));
    expect((await receive(delivery(body))).status).toBe(200);
    expect(lines[0]).toMatchObject({ outcome: "dropped", changed: 0 });
    expect(await getMirrored(sql, "projects", "sbx-p9")).toBeNull();
    const [row] = await sql`select outcome from webhook_deliveries`;
    expect(row?.outcome).toBe("dropped");
  });

  it("MIRROR-R12 strips private teams from a project that is also in a public one", async () => {
    const data = projectData("p9", { teamIds: ["team-sbx", "team-test-a"] });
    await send(envelope("Project", "create", data));
    expect((await getMirrored(sql, "projects", "p9"))?.teamIds).toEqual(["team-test-a"]);
  });

  it("MIRROR-R12 flags a project removed when it moves to private teams only", async () => {
    const moved = projectData("p1", { teamIds: ["team-sbx"], name: "Secret" });
    await send(envelope("Project", "update", moved));
    const row = await getMirrored(sql, "projects", "p1");
    expect(row?.removedAt).not.toBeNull();
    expect(row?.name).toBe("Project p1");
    expect(row?.teamIds).toEqual(["team-test"]);
  });

  it("MIRROR-R12 drops a project whose teams the mirror does not know yet", async () => {
    await send(envelope("Project", "create", projectData("p9", { teamIds: ["team-new"] })));
    expect(await getMirrored(sql, "projects", "p9")).toBeNull();
  });

  it("MIRROR-R12 drops an initiative led by a private team", async () => {
    const data = initiativeData("sbx-i9", { leadTeamId: "team-sbx" });
    await send(envelope("Initiative", "create", data));
    expect(await getMirrored(sql, "initiatives", "sbx-i9")).toBeNull();
  });

  it("MIRROR-R12 drops an update of a project the mirror does not hold", async () => {
    const { receive, lines } = receiver();
    const body = envelope("ProjectUpdate", "create", projectUpdateData("pu-9", "sbx-p1"));
    expect((await receive(delivery(body))).status).toBe(200);
    expect(lines[0]).toMatchObject({ outcome: "dropped" });
    const [row] =
      await sql`select count(*)::int as n from mirror_projects where last_update_id = 'pu-9'`;
    expect(row?.n).toBe(0);
  });
});

describe("unfollowed events", () => {
  it("MIRROR-R11 answers 200 to a type the mirror does not follow and changes nothing", async () => {
    const { receive, lines } = receiver();
    const issue = envelope("Issue", "create", { id: "issue-1", title: "Bug", teamId: "team-test" });
    expect((await receive(delivery(issue))).status).toBe(200);
    expect(lines[0]).toMatchObject({ outcome: "ignored", type: "Issue" });
    const [row] = await sql`select outcome from webhook_deliveries`;
    expect(row?.outcome).toBe("ignored");
  });
});

describe("sync log", () => {
  it("MIRROR-R14 records one webhook entry per delivery and reports when webhooks last ran", async () => {
    const before = await syncStatus(sql);
    expect(before.webhook.lastRunAt).toBeNull();

    await send(envelope("Project", "update", projectData("p1", { name: "Renamed" })));
    await send(envelope("Issue", "create", { id: "issue-1" }));
    const entries = await sql`
      select source, outcome, changed, counts from mirror_sync_log order by id
    `;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      source: "webhook",
      outcome: "ok",
      changed: 1,
      counts: { type: "Project", action: "update", entity: "p1", outcome: "applied", updated: 1 },
    });
    expect(entries[1]).toMatchObject({ source: "webhook", changed: 0 });

    const after = await syncStatus(sql);
    expect(after.webhook).toMatchObject({
      lastRunAt: new Date(sentAt + 2_000).toISOString(),
      lastOutcome: "ok",
    });
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.lastChangeAt).toBe(new Date(sentAt + 2_000).toISOString());
  });

  it("MIRROR-R14 records a failed webhook run when applying fails", async () => {
    await sql`alter table mirror_projects add constraint no_evil check (name <> 'Evil')`;
    try {
      const response = await send(
        envelope("Project", "create", projectData("p9", { name: "Evil" })),
      );
      expect(response.status).toBe(500);
      expect((await syncStatus(sql)).webhook.lastOutcome).toBe("failed");
      expect(await count("webhook_deliveries")).toBe(0);
    } finally {
      await sql`alter table mirror_projects drop constraint no_evil`;
    }
  });
});

describe("log line", () => {
  it("MIRROR-R11 logs one line per delivery with outcome and counts, never the body or secret", async () => {
    const { receive, lines, raw } = receiver();
    const data = projectData("p9", { description: "confidential plan" });
    await receive(delivery(envelope("Project", "create", data)));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: "linear-webhook",
      type: "Project",
      action: "create",
      entity: "p9",
      outcome: "applied",
      status: 200,
      changed: 1,
      counts: { inserted: 1, updated: 0, removed: 0, dropped: 0 },
    });
    expect(raw[0]).not.toContain("confidential");
    expect(raw[0]).not.toContain(webhookSecret);
  });
});
