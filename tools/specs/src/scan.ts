import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CheckInput, SourceFile } from "./check.ts";

/**
 * Directories never scanned besides dot-directories (VCS, the agent scratchpad, agent
 * worktrees under `.claude/`, tool caches): dependencies and build or test output.
 */
const SKIP = new Set([
  "node_modules",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
  "blob-report",
]);

/** Files that may cite requirement ids: Vitest tests and Playwright sources. */
export function isTestFile(path: string): boolean {
  if (/\.test\.tsx?$/.test(path)) return true;
  return path.endsWith(".ts") && path.split("/").slice(0, -1).includes("e2e");
}

/** Reads the specs, records and test files under the repository root. Paths are root-relative. */
export async function collect(root: string): Promise<CheckInput> {
  const tests: string[] = [];
  await walk(root, "", tests);
  tests.sort();

  return {
    ...(await collectDocs(root)),
    tests: await Promise.all(tests.map((path) => read(root, path))),
  };
}

/** Reads the specs and records under the repository root. Paths are root-relative. */
export async function collectDocs(
  root: string,
): Promise<{ specs: SourceFile[]; records: SourceFile[] }> {
  const docs = async (dir: string): Promise<SourceFile[]> => {
    const names = await readdir(join(root, dir)).catch(() => []);
    const files = names.filter((name) => name.endsWith(".md") && name !== "README.md").sort();
    return Promise.all(files.map((name) => read(root, `${dir}/${name}`)));
  };
  return { specs: await docs("docs/specs"), records: await docs("docs/records") };
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  for (const entry of entries) {
    const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && !SKIP.has(entry.name)) await walk(root, path, out);
    } else if (entry.isFile() && isTestFile(path)) {
      out.push(path);
    }
  }
}

async function read(root: string, path: string): Promise<SourceFile> {
  return { path, text: await readFile(join(root, path), "utf8") };
}
