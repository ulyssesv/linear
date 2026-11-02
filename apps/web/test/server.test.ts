import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { closeDatabase } from "../src/server/db/client.ts";
import { startServer } from "../src/server/start.ts";
import { fakeLinear, fixtureWorkspace } from "./mirror-fixtures.ts";
import type { ScratchDatabase } from "./scratch-db.ts";
import { serveEnv } from "./serve-env.ts";
import { scratchDatabase, testDatabaseUrl } from "./test-db.ts";

const dist = inject("dist");
let server: Awaited<ReturnType<typeof startServer>>;
let base: string;

beforeAll(async () => {
  const entry = await import(pathToFileURL(join(dist, "server", "server.js")).href);
  server = await startServer({
    fetch: (request) => entry.default.fetch(request),
    clientDir: join(dist, "client"),
    port: 0,
    silent: true,
  });
  base = server.url;
});

afterAll(async () => {
  await server?.close(true);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeDatabase();
});

describe("server started in-process", () => {
  it("SEED-R20 SEED-R21 /healthz reports the built version and commit", async () => {
    const response = await fetch(new URL("/healthz", base));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      version: inject("builtVersion"),
      commit: inject("builtCommit"),
    });
  });

  it("SEED-R20 MIRROR-R6 /readyz is ready when the database answers", async () => {
    vi.stubEnv("DATABASE_URL", testDatabaseUrl());
    const response = await fetch(new URL("/readyz", base));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", checks: { database: { status: "ok" } } });
  });

  it("SEED-R20 MIRROR-R6 /readyz is not ready when the database cannot be reached", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://linear:linear@127.0.0.1:1/linear");
    const response = await fetch(new URL("/readyz", base));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "fail", failing: ["database"] });
  });

  it("SEED-R18 serves the landing page and its stylesheet", async () => {
    const page = await fetch(base);
    expect(page.status).toBe(200);
    const html = await page.text();
    const href = html.match(/<link rel="stylesheet" href="(\/assets\/[^"]+\.css)"/)?.[1];
    expect(href).toBeDefined();
    const css = await fetch(new URL(href as string, base));
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toMatch(/text\/css/);
  });
});

function cli(args: string[], env: Record<string, string> = {}) {
  return spawn(process.execPath, [join(dist, "cli.mjs"), ...args], {
    env: { PATH: process.env.PATH ?? "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function exit(child: ChildProcess) {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  const [code] = await once(child, "exit");
  return { code, stdout, stderr };
}

/** Serves a fetch-style handler over HTTP on a free local port: Linear, for the built CLI. */
async function serveFetch(handler: typeof globalThis.fetch) {
  const server = createHttpServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = `http://127.0.0.1${req.url ?? "/"}`;
    const response = await handler(url, {
      method: req.method,
      headers: {
        authorization: req.headers.authorization ?? "",
      },
      body,
    });
    res.writeHead(response.status, { "content-type": "application/json" });
    res.end(await response.text());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function freePort() {
  const probe = createServer();
  probe.listen(0);
  await once(probe, "listening");
  const address = probe.address();
  probe.close();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

describe("built CLI", () => {
  let db: ScratchDatabase | undefined;

  afterAll(async () => {
    await db?.drop();
  });

  it("MIRROR-R13 scheduler bootstraps, then reconciles, and exits 0 each time", async () => {
    const scheduler = await scratchDatabase("cli_scheduler");
    const linear = fakeLinear(fixtureWorkspace());
    const stub = await serveFetch(linear.fetch);
    try {
      expect((await exit(cli(["migrate"], { DATABASE_URL: scheduler.url }))).code).toBe(0);
      const env = {
        DATABASE_URL: scheduler.url,
        LINEAR_CLIENT_ID: serveEnv.LINEAR_CLIENT_ID,
        LINEAR_CLIENT_SECRET: serveEnv.LINEAR_CLIENT_SECRET,
        TOKEN_ENCRYPTION_KEY: serveEnv.TOKEN_ENCRYPTION_KEY,
        LINEAR_API_URL: stub.url,
      };
      const first = await exit(cli(["scheduler"], env));
      expect(first, first.stderr).toMatchObject({ code: 0 });
      expect(JSON.parse(first.stdout)).toMatchObject({
        event: "scheduler",
        outcome: "ok",
        source: "bootstrap",
      });
      const second = await exit(cli(["scheduler"], env));
      expect(second, second.stderr).toMatchObject({ code: 0 });
      expect(JSON.parse(second.stdout)).toMatchObject({ outcome: "ok", source: "reconcile" });
      // The second process reused the token the first one stored.
      expect(linear.calls.filter((call) => call.url.endsWith("/oauth/token"))).toHaveLength(1);
    } finally {
      await stub.close();
      await scheduler.drop();
    }
  });

  it("MIRROR-R13 scheduler exits 1 when the database cannot be reached", async () => {
    const { code, stderr } = await exit(
      cli(["scheduler"], {
        DATABASE_URL: "postgres://linear:linear@127.0.0.1:1/linear",
        LINEAR_CLIENT_ID: serveEnv.LINEAR_CLIENT_ID,
        LINEAR_CLIENT_SECRET: serveEnv.LINEAR_CLIENT_SECRET,
        TOKEN_ENCRYPTION_KEY: serveEnv.TOKEN_ENCRYPTION_KEY,
      }),
    );
    expect(code).toBe(1);
    expect(JSON.parse(stderr)).toMatchObject({ event: "scheduler", outcome: "failed" });
  });

  it("MIRROR-R5 migrate applies the bundled migrations, then finds nothing to do", async () => {
    db = await scratchDatabase("cli");
    const first = await exit(cli(["migrate"], { DATABASE_URL: db.url }));
    expect(first).toMatchObject({ code: 0, stdout: expect.stringMatching(/applied .*0001_init/) });
    const again = await exit(cli(["migrate"], { DATABASE_URL: db.url }));
    expect(again).toMatchObject({ code: 0, stdout: expect.stringMatching(/up to date/) });
    const sql = postgres(db.url, { max: 1 });
    try {
      const rows = await sql`select version, name from schema_migrations order by version`;
      expect(rows[0]).toEqual({ version: "0001", name: "init" });
    } finally {
      await sql.end();
    }
  });

  it("MIRROR-R5 migrate exits 1 when the database cannot be reached", async () => {
    const unreachable = "postgres://linear:linear@127.0.0.1:1/linear";
    const { code, stderr } = await exit(cli(["migrate"], { DATABASE_URL: unreachable }));
    expect(code).toBe(1);
    expect(stderr).toMatch(/migrate failed/);
  });

  it("SEED-R22 serve exits non-zero on an invalid environment", async () => {
    const { code, stderr } = await exit(cli(["serve"], { ...serveEnv, PORT: "nope" }));
    expect(code).toBe(1);
    expect(stderr).toMatch(/PORT: /);
  });

  it("MIRROR-R7 serve exits non-zero listing every missing name", async () => {
    const { code, stderr } = await exit(cli(["serve"]));
    expect(code).toBe(1);
    for (const name of Object.keys(serveEnv)) expect(stderr).toContain(`${name}: is required`);
  });

  it("SEED-R24 MIRROR-R6 serve is the default, answers /healthz and /readyz until stopped", async () => {
    const port = await freePort();
    const child = cli([], { ...serveEnv, PORT: String(port), DATABASE_URL: testDatabaseUrl() });
    const done = exit(child);
    try {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 50 && !response; attempt++) {
        response = await fetch(`http://127.0.0.1:${port}/healthz`).catch(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return undefined;
        });
      }
      expect(response?.status).toBe(200);
      // Opens the pool, so the exit below also proves shutdown closes it.
      expect((await fetch(`http://127.0.0.1:${port}/readyz`)).status).toBe(200);
    } finally {
      child.kill("SIGTERM");
    }
    expect((await done).code).toBe(0);
  });
});
