// Nothing but the sync code writes to the mirror (MIRROR-R9). P2 derives dirty and conflict
// state by comparing staged values with the mirror, which only holds while the mirror has
// a single writer: src/server/mirror/apply.ts. This test reads every source file and fails
// when any other file writes a mirror table, or reaches the table mapping that would let it
// write one without naming it.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mirrorTableNames } from "../src/server/mirror/tables.ts";

const root = join(import.meta.dirname, "..");
const src = join(root, "src");
const writer = "src/server/mirror/apply.ts";
/** May import the table mapping: the writer, and the reader, which must not write. */
const mappingUsers = new Set([writer, "src/server/mirror/read.ts"]);

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx|sql)$/.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

/** SQL that changes rows: insert, update, delete, truncate, merge, copy into. */
const write = /\b(insert\s+into|update|delete\s+from|truncate(\s+table)?|merge\s+into|copy)\s+/i;

function writesTo(text: string, table: string): boolean {
  const statement = new RegExp(`${write.source}["'\`]?${table}\\b`, "i");
  return statement.test(text);
}

const mapping = join(src, "server", "mirror", "tables");

/** Whether a file imports src/server/mirror/tables.ts, by relative path or the @/ alias. */
function importsMapping(path: string, text: string): boolean {
  for (const [, specifier = ""] of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const target = specifier.startsWith("@/")
      ? join(src, specifier.slice(2))
      : specifier.startsWith(".")
        ? resolve(dirname(path), specifier)
        : "";
    if (target.replace(/\.ts$/, "") === mapping) return true;
  }
  return false;
}

describe("mirror writers", () => {
  it("MIRROR-R9 the scan knows every mirror table, including the sync log", () => {
    expect(mirrorTableNames).toHaveLength(8);
    expect(writesTo("insert into mirror_projects (id)", "mirror_projects")).toBe(true);
    expect(writesTo('UPDATE "mirror_teams" SET', "mirror_teams")).toBe(true);
    expect(writesTo("delete from mirror_sync_log", "mirror_sync_log")).toBe(true);
    expect(writesTo("select * from mirror_projects", "mirror_projects")).toBe(false);
  });

  it("MIRROR-R9 only src/server/mirror/apply.ts writes to the mirror", async () => {
    const offenders: string[] = [];
    for (const path of await sourceFiles(src)) {
      const file = relative(root, path);
      if (file === writer) continue;
      const text = await readFile(path, "utf8");
      for (const table of [...mirrorTableNames, "mirror_sync_log"]) {
        if (writesTo(text, table)) offenders.push(`${file} writes ${table}`);
      }
      if (importsMapping(path, text) && !mappingUsers.has(file)) {
        offenders.push(`${file} imports the mirror table mapping`);
      }
      if (
        file === "src/server/mirror/read.ts" &&
        write.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))
      ) {
        offenders.push(`${file} contains a write statement`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
