// Fixture builders for the checker tests. This file is not a test file, so the
// citation scan never reads it; ids written here never count as citations.
import { stringify } from "yaml";
import type { SourceFile } from "../src/check.ts";

export const KEY = "FOO";
export const OTHER = "BAR";

/** A requirement id of the fixture spec, built at runtime. */
export function req(n: number, key: string = KEY): string {
  return `${key}-R${n}`;
}

export function specFrontMatter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: KEY,
    title: "Foo",
    status: "draft",
    area: "site-platform",
    linear: {
      initiative: "https://linear.app/acme/initiative/site-platform-1",
      parent: "https://linear.app/acme/project/scaffold-1",
    },
    supersedes: [],
    created: "2026-11-01",
    ...overrides,
  };
}

export function recordFrontMatter(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "REC-001",
    title: "A decision",
    status: "accepted",
    date: "2026-11-01",
    area: "site-platform",
    spec: KEY,
    supersedes: [],
    linear: { initiative: "https://linear.app/acme/initiative/site-platform-1" },
    ...overrides,
  };
}

export function without(data: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const copy = { ...data };
  for (const key of keys) delete copy[key];
  return copy;
}

export function markdown(frontMatter: Record<string, unknown>, body: string[] = []): string {
  return `---\n${stringify(frontMatter)}---\n\n${body.join("\n")}\n`;
}

/** A valid spec body: two unit requirements, one manual, one dropped, two tasks. */
export function specBody(key: string = KEY): string[] {
  return [
    `# ${key}: Fixture`,
    "",
    "## Requirements",
    "",
    `- **${req(1, key)}** (unit) The first thing.`,
    `- **${req(2, key)}** (e2e) The second thing.`,
    `- **${req(3, key)}** (manual) A person checks it.`,
    `- **${req(4, key)}** (dropped) No longer needed.`,
    "",
    "## Tasks",
    "",
    "- [ ] T1 Do the first thing (R1)",
    "- [x] T2 Do the second thing (R2)",
  ];
}

export function spec(
  overrides: Record<string, unknown> = {},
  body: string[] = specBody(),
  path = "docs/specs/001-foo.md",
): SourceFile {
  return { path, text: markdown(specFrontMatter(overrides), body) };
}

export function record(
  overrides: Record<string, unknown> = {},
  path = "docs/records/001-a-decision.md",
): SourceFile {
  return { path, text: markdown(recordFrontMatter(overrides), ["# A decision"]) };
}

/** A test file citing the given ids, one per test name. */
export function testFile(ids: string[], path = "apps/web/src/foo.test.ts"): SourceFile {
  return {
    path,
    text: ids.map((id) => `it("${id} does something", () => {});`).join("\n"),
  };
}

/** Test file citing every unit and e2e requirement of the default fixture spec. */
export function citingAll(): SourceFile {
  return testFile([req(1), req(2)]);
}
