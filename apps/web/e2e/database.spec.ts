// The built `migrate` command and the database readiness check (MIRROR-R5, MIRROR-R6).
// `local` project only: it runs dist/cli.mjs and needs the database from compose.yaml or
// the CI service (MIRROR-R8), never a deployed site.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { localDatabaseUrl } from "../src/server/db/local.ts";

const root = join(import.meta.dirname, "..");
const server = process.env.DATABASE_URL || localDatabaseUrl;

async function migrate(databaseUrl: string) {
  const child = spawn(process.execPath, [join(root, "dist", "cli.mjs"), "migrate"], {
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: databaseUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const [code] = await once(child, "exit");
  return { code, output };
}

test.describe("migrate command", () => {
  test.describe.configure({ mode: "serial" });
  const name = `linear_e2e_${randomBytes(4).toString("hex")}`;
  const url = new URL(server);
  url.pathname = `/${name}`;
  const admin = postgres(server, { max: 1, onnotice: () => {} });

  test.beforeAll(async () => {
    await admin.unsafe(`create database "${name}"`);
  });

  test.afterAll(async () => {
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.end();
  });

  test("MIRROR-R5 applies every pending migration to an empty database and exits 0", async () => {
    const run = await migrate(url.toString());
    expect(run.code, run.output).toBe(0);

    const files = (await readdir(join(root, "src", "server", "db", "migrations")))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const sql = postgres(url.toString(), { max: 1 });
    try {
      const rows = await sql`select version, name from schema_migrations order by version`;
      expect(rows.map((row) => `${row.version}_${row.name}.sql`)).toEqual(files);
    } finally {
      await sql.end();
    }
  });

  test("MIRROR-R5 is safe to run again and exits 0 with nothing to apply", async () => {
    const run = await migrate(url.toString());
    expect(run.code, run.output).toBe(0);
    expect(run.output).toMatch(/up to date/);
  });

  test("MIRROR-R5 exits non-zero when the database cannot be reached", async () => {
    const run = await migrate("postgres://linear:linear@127.0.0.1:1/linear");
    expect(run.code).not.toBe(0);
    expect(run.output).toMatch(/migrate failed/);
  });
});

test("MIRROR-R6 GET /readyz reports the database check as ok", async ({ request }) => {
  const response = await request.get("/readyz");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", checks: { database: { status: "ok" } } });
});
