// POST /webhooks/linear through the production server bundle (MIRROR-R3, MIRROR-R11): the
// route is mounted at linearWebhookPath and reads LINEAR_WEBHOOK_SECRET and DATABASE_URL
// from the environment at request time.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { closeDatabase, createSql, type Sql } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { migrations } from "../src/server/db/migrations.ts";
import { linearWebhookPath } from "../src/server/linear/urls.ts";
import { applyRecords } from "../src/server/mirror/apply.ts";
import { teamFromNode } from "../src/server/mirror/listing.ts";
import { getMirrored } from "../src/server/mirror/read.ts";
import { startServer } from "../src/server/start.ts";
import { fixtureWorkspace } from "./mirror-fixtures.ts";
import type { ScratchDatabase } from "./scratch-db.ts";
import { scratchDatabase } from "./test-db.ts";
import { delivery, envelope, projectData, webhookSecret } from "./webhook-fixtures.ts";

let server: Awaited<ReturnType<typeof startServer>>;
let db: ScratchDatabase;
let sql: Sql;

beforeAll(async () => {
  db = await scratchDatabase("webhook_route");
  sql = createSql(db.url, { max: 2 });
  await migrate(sql, migrations);
  const [team] = fixtureWorkspace().teams;
  await applyRecords(sql, "teams", [teamFromNode(team ?? {})], {
    source: "bootstrap",
    at: new Date(),
  });
  const dist = inject("dist");
  const entry = await import(pathToFileURL(join(dist, "server", "server.js")).href);
  server = await startServer({
    fetch: (request) => entry.default.fetch(request),
    clientDir: join(dist, "client"),
    port: 0,
    silent: true,
  });
  vi.stubEnv("DATABASE_URL", db.url);
  vi.stubEnv("LINEAR_WEBHOOK_SECRET", webhookSecret);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await server?.close(true);
  await closeDatabase();
  await sql?.end({ timeout: 5 });
  await db?.drop();
});

describe("webhook route", () => {
  const url = () => new URL(linearWebhookPath, server.url).href;
  const body = () =>
    envelope("Project", "create", projectData("p-route"), { timestamp: Date.now() });

  it("MIRROR-R11 answers 401 to an unsigned POST at the webhook path", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await fetch(delivery(body(), { url: url(), signature: null }));
    expect(response.status).toBe(401);
    expect(await getMirrored(sql, "projects", "p-route")).toBeNull();
  });

  it("MIRROR-R11 applies a signed delivery posted to linearWebhookPath", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await fetch(delivery(body(), { url: url() }));
    expect(response.status).toBe(200);
    expect(await getMirrored(sql, "projects", "p-route")).toMatchObject({
      name: "Project p-route",
      syncedSource: "webhook",
    });
    expect(log.mock.calls.flat().some((line) => String(line).includes('"outcome":"applied"'))).toBe(
      true,
    );
  });
});
