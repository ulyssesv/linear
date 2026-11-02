// Builds the app and the CLI once for every test that needs the production output, and
// creates a scratch database for the tests that need Postgres (MIRROR-R8).
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { build, createBuilder } from "vite";
import type { TestProject } from "vitest/node";
import { createScratchDatabase } from "./scratch-db.ts";

declare module "vitest" {
  export interface ProvidedContext {
    dist: string;
    builtVersion: string;
    builtCommit: string;
    /** A database of its own for this run, or the reason there is none. */
    database: { url: string } | { error: string };
  }
}

const root = join(import.meta.dirname, "..");
// Distinct values prove the build reads APP_VERSION and APP_COMMIT (SEED-R21).
const builtVersion = "v0.0.0-test";
const builtCommit = "feedfacecafebeef0123456789abcdef01234567";

export default async function setup(project: TestProject) {
  // Inside the package, so the built files resolve bare imports from its node_modules.
  const cache = join(root, "node_modules", ".cache");
  await mkdir(cache, { recursive: true });
  const dist = await mkdtemp(join(cache, "test-dist-"));
  const saved = { APP_VERSION: process.env.APP_VERSION, APP_COMMIT: process.env.APP_COMMIT };
  process.env.APP_VERSION = builtVersion;
  process.env.APP_COMMIT = builtCommit;
  try {
    const builder = await createBuilder({
      root,
      logLevel: "silent",
      build: { outDir: dist },
      environments: {
        client: { build: { outDir: join(dist, "client") } },
        ssr: { build: { outDir: join(dist, "server") } },
      },
    });
    await builder.buildApp();
    await build({
      root,
      configFile: join(root, "vite.cli.config.ts"),
      logLevel: "silent",
      build: { outDir: dist },
    });
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  project.provide("dist", dist);
  project.provide("builtVersion", builtVersion);
  project.provide("builtCommit", builtCommit);

  // Tests that need Postgres fail with this message when it cannot be reached; the rest
  // still run. Skipping instead would let CI pass without testing the database.
  const database = await createScratchDatabase("run").catch((error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
  );
  project.provide(
    "database",
    database instanceof Error ? { error: database.message } : { url: database.url },
  );

  return async () => {
    if (!(database instanceof Error)) await database.drop();
    await rm(dist, { recursive: true, force: true });
  };
}
