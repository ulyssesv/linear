import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collect } from "../src/scan.ts";

let root: string;

function write(path: string, text = ""): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "specs-scan-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("collect", () => {
  it("SEED-R8 reads every spec and record and skips the format READMEs", async () => {
    write("docs/specs/001-foo.md", "spec");
    write("docs/specs/README.md");
    write("docs/records/001-bar.md", "record");
    write("docs/records/README.md");
    write("docs/other/002-baz.md");

    const input = await collect(root);

    expect(input.specs).toEqual([{ path: "docs/specs/001-foo.md", text: "spec" }]);
    expect(input.records).toEqual([{ path: "docs/records/001-bar.md", text: "record" }]);
  });

  it("SEED-R9 scans test files and e2e sources, skipping dependencies and build output", async () => {
    const scanned = [
      "apps/web/e2e/helpers/server.ts",
      "apps/web/e2e/landing.ts",
      "apps/web/src/env.test.ts",
      "apps/web/src/landing.test.tsx",
      "tools/specs/test/check.test.ts",
    ];
    const ignored = [
      "apps/web/src/env.ts",
      "apps/web/src/env.spec.ts",
      "apps/web/e2e/fixture.json",
      "node_modules/pkg/index.test.ts",
      "apps/web/node_modules/pkg/e2e/x.ts",
      "apps/web/dist/a.test.ts",
      ".context/notes.test.ts",
      ".git/hooks/x.test.ts",
      "apps/web/.output/a.test.ts",
      "apps/web/coverage/a.test.ts",
    ];
    for (const path of [...scanned, ...ignored]) write(path, path);

    const input = await collect(root);

    expect(input.tests).toEqual(scanned.map((path) => ({ path, text: path })));
  });

  it("SEED-R8 returns empty lists when docs are missing", async () => {
    expect(await collect(root)).toEqual({ specs: [], records: [], tests: [] });
  });
});
