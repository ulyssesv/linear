import { describe, expect, it } from "vitest";
import { mirrorDocs, parseLinearUrl } from "../src/mirror.ts";
import { markdown, record, spec, specBody, specFrontMatter } from "./fixtures.ts";

const SOURCE = { repository: "acme/repo", commit: "0123456789abcdef0123456789abcdef01234567" };

describe("parseLinearUrl", () => {
  it("SEED-R10 reads projects, issues and initiatives from their URLs", () => {
    expect(parseLinearUrl("https://linear.app/acme/project/scaffold-674a01efb950")).toEqual({
      kind: "project",
      key: "674a01efb950",
      url: "https://linear.app/acme/project/scaffold-674a01efb950",
    });
    expect(parseLinearUrl("https://linear.app/acme/project/scaffold-674a01efb950/issues")).toEqual(
      expect.objectContaining({ kind: "project", key: "674a01efb950" }),
    );
    expect(parseLinearUrl("https://linear.app/acme/issue/LIN-15/t13-not-found-page")).toEqual(
      expect.objectContaining({ kind: "issue", key: "LIN-15" }),
    );
    expect(parseLinearUrl("https://linear.app/acme/initiative/site-platform-6ac5ff8c3199")).toEqual(
      expect.objectContaining({ kind: "initiative", key: "6ac5ff8c3199" }),
    );
  });

  it("SEED-R10 rejects URLs that name no project, issue or initiative", () => {
    expect(parseLinearUrl("https://linear.app/acme/document/spec-001-abc")).toBeUndefined();
    expect(parseLinearUrl("https://example.com/acme/project/x-1")).toBeUndefined();
    expect(parseLinearUrl("not a url")).toBeUndefined();
  });
});

describe("mirrorDocs", () => {
  it("SEED-R10 titles a spec SPEC-NNN <title> on its parent project or issue", () => {
    const { docs, errors } = mirrorDocs(
      {
        specs: [
          spec({}, specBody(), "docs/specs/007-foo.md"),
          spec(
            {
              id: "BAR",
              title: "Bar",
              linear: { parent: "https://linear.app/acme/issue/LIN-9/bar" },
            },
            specBody("BAR"),
            "docs/specs/012-bar.md",
          ),
        ],
        records: [],
      },
      SOURCE,
    );

    expect(errors).toEqual([]);
    expect(docs.map((d) => [d.prefix, d.title, d.parent.kind, d.parent.key])).toEqual([
      ["SPEC-007", "SPEC-007 Foo", "project", "1"],
      ["SPEC-012", "SPEC-012 Bar", "issue", "LIN-9"],
    ]);
  });

  it("SEED-R10 titles a record REC-NNN <title> on its initiative", () => {
    const { docs, errors } = mirrorDocs(
      { specs: [], records: [record({ id: "REC-004", title: "Pick a thing" })] },
      SOURCE,
    );

    expect(errors).toEqual([]);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      prefix: "REC-004",
      title: "REC-004 Pick a thing",
      parent: { kind: "initiative", key: "1" },
    });
  });

  it("SEED-R10 reports files whose front matter names no usable Linear parent", () => {
    const { docs, errors } = mirrorDocs(
      {
        specs: [
          spec({ linear: { parent: "https://linear.app/acme/initiative/site-platform-1" } }),
          { path: "docs/specs/002-broken.md", text: "no front matter\n" },
        ],
        records: [record({ linear: {} })],
      },
      SOURCE,
    );

    expect(docs).toEqual([]);
    expect(errors.map((e) => e.path)).toEqual([
      "docs/specs/001-foo.md",
      "docs/specs/002-broken.md",
      "docs/records/001-a-decision.md",
    ]);
    expect(errors[0]?.message).toMatch(/project or issue/);
    expect(errors[2]?.message).toMatch(/initiative/);
  });

  it("SEED-R11 mirrors the body after the front matter without the H1 that repeats the title", () => {
    const text = markdown(specFrontMatter({ title: "Foo", status: "implementing" }), [
      "# FOO: Foo",
      "",
      "## 1. Context",
      "",
      "Body text.",
    ]);
    const { docs } = mirrorDocs(
      { specs: [{ path: "docs/specs/001-foo.md", text }], records: [] },
      SOURCE,
    );

    const content = docs[0]?.content ?? "";
    const [header, ...rest] = content.split("\n");
    expect(rest.join("\n")).toBe("\n## 1. Context\n\nBody text.\n");
    expect(content).not.toContain("# FOO: Foo");
    expect(content).not.toContain("status: implementing");
    expect(header).toBe(
      "> Mirror of `docs/specs/001-foo.md` in " +
        "[acme/repo](https://github.com/acme/repo/blob/0123456789abcdef0123456789abcdef01234567/docs/specs/001-foo.md) " +
        "at commit `0123456`. The file is the source of truth. Status: **implementing**.",
    );
  });

  it("SEED-R11 keeps a leading H1 that does not repeat the title", () => {
    const text = markdown(specFrontMatter({ title: "Foo" }), ["# Something else", "", "Text."]);
    const { docs } = mirrorDocs(
      { specs: [{ path: "docs/specs/001-foo.md", text }], records: [] },
      SOURCE,
    );

    expect(docs[0]?.content).toContain("\n\n# Something else\n\nText.\n");
  });

  it("SEED-R11 names the spec that prompted a record in its header", () => {
    const { docs } = mirrorDocs({ specs: [], records: [record({ spec: "FOO" })] }, SOURCE);

    expect(docs[0]?.content.split("\n")[0]).toMatch(
      /The file is the source of truth\. Status: \*\*accepted\*\*\. Spec: FOO\.$/,
    );
  });
});
