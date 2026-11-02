// MIRROR-R22 (check): exactly one module imports the grid library. REC-004 keeps
// Handsontable behind src/sheets/grid/handsontable-adapter.tsx so that replacing the grid
// means a new adapter and theme, nothing else. This test reads every source file in the
// repository and fails `pnpm test`, and so `pnpm check` and CI, when any other file
// imports `handsontable` or an `@handsontable/*` package in any form: static, side-effect
// (CSS included), dynamic, re-export, require, CSS @import, or a node_modules path. It
// also fails when the adapter stops importing the library, or registers the formulas
// plugin or every module at once (REC-004: no Handsontable formulas, no HyperFormula).
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const repository = join(import.meta.dirname, "..", "..", "..");
const adapter = "apps/web/src/sheets/grid/handsontable-adapter.tsx";

/** Never scanned: dependencies, build and test output, dot-directories (VCS, worktrees). */
const skip = new Set([
  "node_modules",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
  "blob-report",
]);
const sourceFile = /\.(?:[cm]?[jt]sx?|css|scss|sass|less|html|vue|svelte|astro)$/;

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name.startsWith(".") || skip.has(entry.name) ? [] : sourceFiles(path);
      }
      return sourceFile.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

// Built from parts so this file never matches its own scan.
const lib = ["hands", "ontable"].join("");

/** Whether a module specifier names the grid library or one of its packages. */
function isGridLibrary(specifier: string): boolean {
  const bare = specifier.replace(/^~/, "").replace(/[?#].*$/, "");
  const scoped = new RegExp(`^(?:${lib}|@${lib}/[^/]+)(?:/|$)`);
  const inModules = new RegExp(`(?:^|/)node_modules/(?:${lib}|@${lib}/[^/]+)(?:/|$)`);
  return scoped.test(bare) || inModules.test(bare);
}

/** Every module specifier a source file names, in any import form. */
function specifiers(text: string): string[] {
  const quoted = String.raw`["'\`]([^"'\`]+)["'\`]`;
  const forms = [
    // import x from "m", import { x } from "m", import type ..., export ... from "m"
    String.raw`\bfrom\s*${quoted}`,
    // import "m" (side effects, stylesheets)
    String.raw`\bimport\s*${quoted}`,
    // import("m"), require("m"), require.resolve("m"), import.meta.resolve("m")
    String.raw`\b(?:import|require|require\.resolve|import\.meta\.resolve)\s*\(\s*${quoted}`,
    // CSS: @import "m", @import url(m), @import url("m")
    String.raw`@import\s+(?:url\(\s*)?["']?([^"')\s;]+)`,
    // /// <reference types="m" />
    String.raw`<reference\s+(?:types|path)\s*=\s*${quoted}`,
  ];
  const found: string[] = [];
  for (const form of forms) {
    for (const match of text.matchAll(new RegExp(form, "g"))) {
      if (match[1]) found.push(match[1]);
    }
  }
  return found;
}

function importsGridLibrary(text: string): boolean {
  return specifiers(text).some(isGridLibrary);
}

describe("grid boundary", () => {
  it("MIRROR-R22 recognises every way of importing the grid library", () => {
    const imports = [
      `import { HotTable } from "@${lib}/react-wrapper";`,
      `import type Grid from "${lib}/base";`,
      `import "${lib}/styles/${lib}.min.css";`,
      `import styles from "${lib}/styles/ht-theme-main.css?url";`,
      `const grid = await import("${lib}");`,
      `const grid = await import(\n  '${lib}/plugins'\n);`,
      `export { HotTable } from "@${lib}/react-wrapper";`,
      `export * from "${lib}/base";`,
      `const grid = require("${lib}");`,
      `@import "${lib}/styles/${lib}.css";`,
      `@import url(${lib}/styles/${lib}.css);`,
      `@import '~${lib}/dist/${lib}.full.css';`,
      `import x from "../../node_modules/${lib}/base.mjs";`,
      `/// <reference types="${lib}" />`,
    ];
    for (const text of imports) expect(importsGridLibrary(text), text).toBe(true);

    const others = [
      `import Grid from "./grid/${lib}-adapter.tsx";`,
      `const Grid = lazy(() => import("./grid/${lib}-adapter.tsx"));`,
      `import x from "${lib}-plus";`,
      `import x from "@other/${lib}";`,
      `const name = "${lib}";`,
    ];
    for (const text of others) expect(importsGridLibrary(text), text).toBe(false);
  });

  it(`MIRROR-R22 only ${adapter} imports the grid library`, async () => {
    const importers: string[] = [];
    for (const path of await sourceFiles(repository)) {
      if (importsGridLibrary(await readFile(path, "utf8"))) {
        importers.push(relative(repository, path));
      }
    }
    expect(importers).toEqual([adapter]);
  });

  it("MIRROR-R22 the adapter registers no formulas plugin and not every module", async () => {
    const text = await readFile(join(repository, adapter), "utf8");
    const imported = specifiers(text).filter(isGridLibrary);
    expect(imported.length).toBeGreaterThan(0);
    // The full build and the barrels register or pull in every module, formulas included.
    const everything = new RegExp(`^(?:${lib}|${lib}/(?:registry|plugins|index))$`);
    for (const specifier of imported) {
      expect(specifier).not.toMatch(/formula/i);
      expect(specifier).not.toMatch(everything);
    }
    expect(text).not.toMatch(/registerAll(?:Modules|Plugins)|Formulas|HyperFormula/);
  });
});
