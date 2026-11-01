// Builds the app and the CLI once for every test that needs the production output.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { build, createBuilder } from "vite";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    dist: string;
    builtVersion: string;
    builtCommit: string;
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
  return () => rm(dist, { recursive: true, force: true });
}
