// Linear Diffs review categories come from .gitattributes (CONTENT-R10).
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");

const category = (path: string) =>
  execFileSync("git", ["check-attr", "review-documentation", "--", path], {
    cwd: root,
    encoding: "utf8",
  }).trim();

describe("review categories", () => {
  it("CONTENT-R10 copy under apps/web/content groups with documentation", () => {
    expect(category("apps/web/content/about.mdx")).toMatch(/: review-documentation: set$/);
    expect(category("apps/web/content/nested/page.mdx")).toMatch(/: set$/);
    expect(category("apps/web/src/routes/about.tsx")).toMatch(/: unspecified$/);
  });
});
