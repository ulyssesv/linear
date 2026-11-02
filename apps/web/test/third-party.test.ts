// What the site ships is open source, or a demo library under a licence an accepted record
// chooses, and is listed with its licence; no Linear mark is in the repository except the
// logomark on the sign-in controls (CONTENT-R16).
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

/**
 * A licence outside the open-source set is allowed when an accepted record chooses it
 * and names the package (by its name without the npm scope).
 */
const records = readdirSync(join(web, "..", "..", "docs", "records")).filter((name) =>
  /^\d{3}-/.test(name),
);
function acceptedRecord(licence: string, name: string): boolean {
  const id = /REC-(\d{3})/.exec(licence)?.[1];
  const file = records.find((record) => record.startsWith(`${id}-`));
  if (!id || !file) return false;
  const text = readFileSync(join(web, "..", "..", "docs", "records", file), "utf8");
  const named = name.replace(/^@/, "").split("/")[0] ?? name;
  return /^status: accepted$/m.test(text) && text.toLowerCase().includes(named.toLowerCase());
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
      if (acceptedRecord(licence, name ?? "")) continue;
      expect(openSource.has(licence), `${name}: ${licence}`).toBe(true);
      expect(declaredLicence(name ?? ""), name).toBe(licence);
    }
  });

  it("CONTENT-R16 a licence outside open source must cite an accepted record naming the package", () => {
    const licence = "Non-commercial licence, REC-004";
    expect(acceptedRecord(licence, "handsontable")).toBe(true);
    expect(acceptedRecord(licence, "@handsontable/react-wrapper")).toBe(true);
    expect(acceptedRecord(licence, "ag-grid-enterprise")).toBe(false);
    expect(acceptedRecord("Non-commercial licence", "handsontable")).toBe(false);
    expect(acceptedRecord("Non-commercial licence, REC-999", "handsontable")).toBe(false);
    const closed = [...listed].filter(([, licence = ""]) => !openSource.has(licence));
    expect(closed.map(([name]) => name).sort()).toEqual([
      "@handsontable/react-wrapper",
      "handsontable",
    ]);
    for (const [name = "", licence = ""] of closed) {
      expect(acceptedRecord(licence, name), `${name}: ${licence}`).toBe(true);
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

  it("CONTENT-R16 Linear's logomark is in one component, unaltered", () => {
    const markPath = "M1.22541 61.5228c-.2225-.9485.90748-1.5459";
    const holders = all.filter(
      (path) => /\.(?:tsx?|css|mdx|html)$/.test(path) && !path.startsWith("test/"),
    );
    const withMark = holders.filter((path) =>
      readFileSync(join(web, path), "utf8").includes(markPath),
    );
    expect(withMark).toEqual(["src/components/linear-mark.tsx"]);
    const mark = readFileSync(join(web, "src/components/linear-mark.tsx"), "utf8");
    // Brand kit logo-light.svg: one path, white fill, 100 by 100 view box.
    expect(mark.match(/<path /g)).toHaveLength(1);
    expect(mark).toContain('fill="#fff"');
    expect(mark).toContain('viewBox="0 0 100 100"');
    expect(mark).toMatch(/ZM12\.6587 18\.074c[^"]+L12\.6587 18\.074Z" \/>/);
  });

  it("CONTENT-R16 only the sign-in controls use Linear's logomark", () => {
    const users = all.filter(
      (path) =>
        path.startsWith("src/") &&
        /from "@\/components\/linear-mark"/.test(readFileSync(join(web, path), "utf8")),
    );
    expect(users.sort()).toEqual(["src/components/site-header.tsx", "src/routes/sign-in.tsx"]);
    const header = readFileSync(join(web, "src/components/site-header.tsx"), "utf8");
    expect(header.match(/<LinearMark/g)).toHaveLength(1);
    expect(header).toMatch(
      /href=\{signInHref\(href\)\}[\s\S]*?<LinearMark[\s\S]*?Sign in\s*<\/SiteLink>/,
    );
    const signIn = readFileSync(join(web, "src/routes/sign-in.tsx"), "utf8");
    expect(signIn.match(/<LinearMark/g)).toHaveLength(1);
    expect(signIn).toMatch(/href=\{start\}[\s\S]*?<LinearMark[\s\S]*?Sign in<span/);
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
