import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { record, spec } from "./fixtures.ts";

const pkg = resolve(import.meta.dirname, "..");

function cli(root: string, ...args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
  };
  delete env.LINEAR_API_KEY;
  const result = spawnSync(process.execPath, ["src/sync-cli.ts", root, ...args], {
    cwd: pkg,
    encoding: "utf8",
    env,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

let root: string;

function write(file: { path: string; text: string }): void {
  mkdirSync(dirname(join(root, file.path)), { recursive: true });
  writeFileSync(join(root, file.path), file.text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "specs-sync-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("linear:sync", () => {
  it("SEED-R13 exits 1 without LINEAR_API_KEY, naming the setup task, before any request", () => {
    write(spec());
    write(record());

    const { code, stderr } = cli(root, "--dry-run");

    expect(code).toBe(1);
    expect(stderr).toMatch(/LINEAR_API_KEY is not set/);
    expect(stderr).toMatch(/LIN-11/);
  });

  it("SEED-R10 exits 1 and names files without a usable Linear parent", () => {
    write(spec({ linear: {} }));

    const { code, stderr } = cli(root, "--dry-run");

    expect(code).toBe(1);
    expect(stderr).toMatch(/^docs\/specs\/001-foo\.md:\d+: .*linear\.parent/m);
  });
});
