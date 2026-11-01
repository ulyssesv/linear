import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { record, req, spec, specBody, testFile } from "./fixtures.ts";

const pkg = resolve(import.meta.dirname, "..");
const repo = resolve(pkg, "../..");

function cli(root: string) {
  const result = spawnSync(process.execPath, ["src/cli.ts", root], { cwd: pkg, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

let root: string;

function write(file: { path: string; text: string }): void {
  mkdirSync(dirname(join(root, file.path)), { recursive: true });
  writeFileSync(join(root, file.path), file.text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "specs-cli-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("check:specs", () => {
  it("SEED-R8 exits 1 and prints each problem as file:line", () => {
    write(spec({ status: "finished" }, [...specBody(), `- **${req(5)}** missing tag`]));
    write(record());

    const { code, stderr } = cli(root);

    expect(code).toBe(1);
    expect(stderr).toMatch(/^docs\/specs\/001-foo\.md:\d+: .*finished/m);
    expect(stderr).toMatch(/^docs\/specs\/001-foo\.md:\d+: malformed requirement/m);
  });

  it("SEED-R9 exits 1 when a test cites an undefined id", () => {
    write(spec());
    write(record());
    write(testFile([req(1), req(2), req(7)]));

    const { code, stderr } = cli(root);

    expect(code).toBe(1);
    expect(stderr).toMatch(new RegExp(`^apps/web/src/foo\\.test\\.ts:3: .*${req(7)}`, "m"));
  });

  it("SEED-R9 prints pending requirements and exits 0", () => {
    write(spec({ status: "implementing" }));
    write(record());
    write(testFile([req(1)]));

    const { code, stdout, stderr } = cli(root);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain(req(2));
    expect(stdout).not.toMatch(new RegExp(`\\b${req(1)}\\b`));
  });

  it("SEED-R8 SEED-R9 passes on this repository's specs, records and tests", () => {
    const { code, stderr } = cli(repo);
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });
});
