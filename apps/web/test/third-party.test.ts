// What the site ships is open source and listed with its licence, and no Linear mark is
// in the repository (CONTENT-R16).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const web = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(web, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const thirdParty = readFileSync(join(web, "THIRD_PARTY.md"), "utf8");

const openSource = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "OFL-1.1",
  "Unlicense",
]);

/** Rows of the tables: [name, package, licence, source]. */
const rows = thirdParty
  .split("\n")
  .filter((line) => line.startsWith("| ") && !line.startsWith("| Name") && !line.startsWith("| --"))
  .map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );
const listed = new Map(
  rows.filter((row) => row[1]?.startsWith("`")).map((row) => [row[1]?.slice(1, -1), row[2]]),
);

const packageOf = (spec: string) =>
  (spec.startsWith("@") ? spec.split("/").slice(0, 2) : spec.split("/").slice(0, 1)).join("/");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:tsx?|css)$/.test(entry.name) && !entry.name.endsWith(".gen.ts") ? [path] : [];
  });
}

/** Packages the app's source imports, stylesheet imports included: what the site ships. */
const importedPackages = [
  ...new Set(
    sourceFiles(join(web, "src")).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/(?:from|import) "([^"]+)"/g)]
        .map(([, spec = ""]) => spec)
        .filter((spec) => !/^(?:\.|@\/|node:)/.test(spec))
        .map(packageOf),
    ),
  ),
];

/** A licence outside the open-source set is allowed when an accepted record chooses it. */
const records = readdirSync(join(web, "..", "..", "docs", "records")).filter((name) =>
  /^\d{3}-/.test(name),
);
function acceptedRecord(licence: string): boolean {
  const id = /REC-(\d{3})/.exec(licence)?.[1];
  const file = records.find((name) => name.startsWith(`${id}-`));
  if (!id || !file) return false;
  const text = readFileSync(join(web, "..", "..", "docs", "records", file), "utf8");
  return /^status: accepted$/m.test(text);
}

const declaredLicence = (name: string): string =>
  (
    JSON.parse(readFileSync(join(web, "node_modules", name, "package.json"), "utf8")) as {
      license: string;
    }
  ).license;

describe("third-party licences", () => {
  it("CONTENT-R16 every runtime dependency and every package the source imports is listed", () => {
    const shipped = new Set([...Object.keys(manifest.dependencies), ...importedPackages]);
    expect(importedPackages).toContain("@fontsource-variable/inter");
    expect(importedPackages).toContain("react");
    for (const name of shipped) expect(listed.has(name), `${name} in THIRD_PARTY.md`).toBe(true);
  });

  it("CONTENT-R16 every listed package has the licence it declares, and it is open source", () => {
    for (const [name, licence = ""] of listed) {
      if (acceptedRecord(licence)) continue;
      expect(openSource.has(licence), `${name}: ${licence}`).toBe(true);
      expect(declaredLicence(name ?? ""), name).toBe(licence);
    }
  });

  it("CONTENT-R16 a licence outside open source must cite an accepted record", () => {
    expect(acceptedRecord("Non-commercial licence, REC-004")).toBe(true);
    expect(acceptedRecord("Non-commercial licence")).toBe(false);
    expect(acceptedRecord("Non-commercial licence, REC-999")).toBe(false);
    const closed = [...listed].filter(([, licence = ""]) => !openSource.has(licence));
    for (const [name, licence = ""] of closed) {
      expect(acceptedRecord(licence), `${name}: ${licence}`).toBe(true);
    }
  });

  it("CONTENT-R16 vendored icon and component sets are listed", () => {
    const icons = readFileSync(join(web, "src", "components", "icons.tsx"), "utf8");
    expect(icons).toMatch(/Lucide/);
    expect(thirdParty).toMatch(/\| Lucide .*\| vendored \| ISC \|/);
    expect(readdirSync(join(web, "src", "components", "ui")).length).toBeGreaterThan(0);
    expect(thirdParty).toMatch(/\| shadcn\/ui .*\| vendored \| MIT \|/);
  });
});

const skip = new Set(["node_modules", "dist", "test-results", "playwright-report", "coverage"]);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || skip.has(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const image = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|icns)$/i;

describe("no Linear marks", () => {
  const all = files(web).map((path) => relative(web, path));

  it("CONTENT-R16 no image file is named like a Linear mark", () => {
    const marks = all.filter(
      (path) => image.test(path) && /linear|logo|wordmark|logomark|brand/i.test(path),
    );
    expect(marks).toEqual([]);
  });

  it("CONTENT-R16 no SVG file mentions Linear", () => {
    const svgs = all.filter((path) => path.endsWith(".svg"));
    for (const path of svgs) expect(readFileSync(join(web, path), "utf8")).not.toMatch(/linear/i);
  });

  it("CONTENT-R16 no source loads an asset from a Linear host", () => {
    const sources = all.filter(
      (path) => /\.(?:tsx?|css|mdx|html)$/.test(path) && !path.startsWith("test/"),
    );
    const assetHost = /(?:cdn|static|assets?)\.linear\.app|linear\.app\/(?:static|cdn|_next)/;
    for (const path of sources) {
      expect(readFileSync(join(web, path), "utf8"), path).not.toMatch(assetHost);
    }
  });
});
