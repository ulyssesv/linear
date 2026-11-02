import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = resolve(import.meta.dirname, "..");

function cli(...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.LINEAR_API_KEY;
  const result = spawnSync(process.execPath, ["src/cli.ts", ...args], {
    cwd: pkg,
    encoding: "utf8",
    env,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("seed:fixtures", () => {
  it("MIRROR-R27 explains itself, the personal key and the dry run in --help", () => {
    const { code, stdout } = cli("--help");
    expect(code).toBe(0);
    expect(stdout).toMatch(/--dry-run/);
    expect(stdout).toMatch(/LINEAR_API_KEY/);
    expect(stdout).toMatch(/personal API key/);
    expect(stdout).toMatch(/never deletes/);
  });

  it("MIRROR-R27 exits 1 without LINEAR_API_KEY, before any request", () => {
    const { code, stderr } = cli("--dry-run");
    expect(code).toBe(1);
    expect(stderr).toMatch(/LINEAR_API_KEY is not set/);
  });

  it("MIRROR-R27 exits 2 on an unknown option", () => {
    const { code, stderr } = cli("--force");
    expect(code).toBe(2);
    expect(stderr).toMatch(/--force/);
  });
});
