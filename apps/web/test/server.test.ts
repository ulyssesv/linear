import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { startServer } from "../src/server/start.ts";

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

  it("SEED-R20 /readyz is ready with no registered checks", async () => {
    const response = await fetch(new URL("/readyz", base));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", checks: {} });
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
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  const [code] = await once(child, "exit");
  return { code, stderr };
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
  it.each([["scheduler"], ["migrate"]])("SEED-R24 %s exits 2", async (command) => {
    const { code, stderr } = await exit(cli([command]));
    expect(code).toBe(2);
    expect(stderr).toMatch(/planning-sheet spec/);
  });

  it("SEED-R22 serve exits non-zero on an invalid environment", async () => {
    const { code, stderr } = await exit(cli(["serve"], { PORT: "nope" }));
    expect(code).toBe(1);
    expect(stderr).toMatch(/PORT: /);
  });

  it("SEED-R24 serve is the default and answers /healthz until stopped", async () => {
    const port = await freePort();
    const child = cli([], { PORT: String(port) });
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
    } finally {
      child.kill("SIGTERM");
    }
    expect((await done).code).toBe(0);
  });
});
