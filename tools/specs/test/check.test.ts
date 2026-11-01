import { describe, expect, it } from "vitest";
import { type CheckInput, check, type Problem } from "../src/check.ts";
import {
  citingAll,
  KEY,
  markdown,
  OTHER,
  record,
  recordFrontMatter,
  req,
  spec,
  specBody,
  specFrontMatter,
  testFile,
  without,
} from "./fixtures.ts";

function run(input: Partial<CheckInput>) {
  return check({ specs: [spec()], records: [record()], tests: [citingAll()], ...input });
}

function messages(errors: Problem[]): string[] {
  return errors.map((e) => `${e.path}:${e.line ?? "-"}: ${e.message}`);
}

/** 1-based line number of the first line of `text` containing `needle`. */
function lineOf(text: string, needle: string): number {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  if (index === -1) throw new Error(`fixture has no line containing ${needle}`);
  return index + 1;
}

describe("front matter", () => {
  it("SEED-R8 accepts a valid spec and record", () => {
    expect(messages(run({}).errors)).toEqual([]);
  });

  it("SEED-R8 rejects a spec without front matter", () => {
    const { errors } = run({ specs: [{ path: "docs/specs/001-foo.md", text: "# Foo\n" }] });
    expect(messages(errors)).toContainEqual(expect.stringMatching(/001-foo\.md:1: .*front matter/));
  });

  it("SEED-R8 rejects front matter that is not valid YAML", () => {
    const text = "---\nid: [unclosed\n---\n\n# Foo\n";
    const { errors } = run({ specs: [{ path: "docs/specs/001-foo.md", text }] });
    expect(messages(errors)).toContainEqual(expect.stringMatching(/001-foo\.md:\d+: .*YAML/i));
  });

  it("SEED-R8 rejects a spec with an unknown status, at the status line", () => {
    const file = spec({ status: "finished" });
    const { errors } = run({ specs: [file] });
    expect(errors).toContainEqual({
      path: file.path,
      line: lineOf(file.text, "status:"),
      message: expect.stringMatching(/status.*finished/),
    });
  });

  it("SEED-R8 rejects a spec with an unknown area", () => {
    const { errors } = run({ specs: [spec({ area: "marketing" })] });
    expect(messages(errors)).toContainEqual(expect.stringMatching(/area.*marketing/));
  });

  it("SEED-R8 rejects a spec without a Linear parent", () => {
    const linear = { initiative: "https://linear.app/acme/initiative/site-platform-1" };
    const { errors } = run({ specs: [spec({ linear })] });
    expect(messages(errors)).toContainEqual(expect.stringMatching(/linear\.parent/));
  });

  it("SEED-R8 rejects a Linear parent that is neither a project nor an issue", () => {
    const linear = {
      initiative: "https://linear.app/acme/initiative/site-platform-1",
      parent: "https://linear.app/acme/document/foo-1",
    };
    const { errors } = run({ specs: [spec({ linear })] });
    expect(messages(errors)).toContainEqual(expect.stringMatching(/linear\.parent/));
  });

  it("SEED-R8 accepts an issue as the Linear parent", () => {
    const linear = {
      initiative: "https://linear.app/acme/initiative/site-platform-1",
      parent: "https://linear.app/acme/issue/LIN-12/foo",
    };
    expect(messages(run({ specs: [spec({ linear })] }).errors)).toEqual([]);
  });

  it("SEED-R8 rejects a spec without a Linear initiative", () => {
    const linear = { parent: "https://linear.app/acme/project/scaffold-1" };
    const { errors } = run({ specs: [spec({ linear })] });
    expect(messages(errors)).toContainEqual(expect.stringMatching(/linear\.initiative/));
  });

  it.each(["id", "title", "status", "area", "linear", "supersedes", "created"])(
    "SEED-R8 rejects a spec missing %s",
    (field) => {
      const file = {
        path: "docs/specs/001-foo.md",
        text: markdown(without(specFrontMatter(), field), specBody()),
      };
      const { errors } = run({ specs: [file] });
      expect(messages(errors)).toContainEqual(expect.stringContaining(field));
    },
  );

  it.each(["foo", "Foo", "1FOO", "FOO-BAR"])("SEED-R8 rejects the spec id %j", (id) => {
    const { errors } = run({ specs: [spec({ id }, [])], records: [record({ spec: undefined })] });
    expect(messages(errors)).toContainEqual(expect.stringMatching(/\bid\b/));
  });

  it("SEED-R8 rejects a created date that is not YYYY-MM-DD", () => {
    const { errors } = run({ specs: [spec({ created: "1 November 2026" })] });
    expect(messages(errors)).toContainEqual(expect.stringMatching(/created/));
  });

  it("SEED-R8 rejects a spec file name not shaped NNN-slug.md", () => {
    const { errors } = run({ specs: [spec({}, specBody(), "docs/specs/foo.md")] });
    expect(messages(errors)).toContainEqual(expect.stringMatching(/foo\.md.*NNN-slug/));
  });

  it("SEED-R8 rejects a record with an unknown status", () => {
    const { errors } = run({ records: [record({ status: "approved" })] });
    expect(messages(errors)).toContainEqual(expect.stringMatching(/status.*approved/));
  });

  it("SEED-R8 rejects a record with an unknown area", () => {
    const { errors } = run({ records: [record({ area: "marketing" })] });
    expect(messages(errors)).toContainEqual(expect.stringMatching(/area.*marketing/));
  });

  it.each(["id", "title", "status", "date", "area", "linear", "supersedes"])(
    "SEED-R8 rejects a record missing %s",
    (field) => {
      const file = {
        path: "docs/records/001-a-decision.md",
        text: markdown(without(recordFrontMatter(), field)),
      };
      const { errors } = run({ records: [file] });
      expect(messages(errors)).toContainEqual(expect.stringContaining(field));
    },
  );

  it("SEED-R8 rejects a record id that does not match its file number", () => {
    const { errors } = run({ records: [record({ id: "REC-002" })] });
    expect(messages(errors)).toContainEqual(expect.stringMatching(/REC-002.*001/));
  });

  it("SEED-R8 rejects a record that names an unknown spec", () => {
    const { errors } = run({ records: [record({ spec: OTHER })] });
    expect(messages(errors)).toContainEqual(expect.stringMatching(new RegExp(`spec.*${OTHER}`)));
  });

  it("SEED-R8 accepts a record without a spec", () => {
    expect(messages(run({ records: [record({ spec: undefined })] }).errors)).toEqual([]);
  });

  it("SEED-R8 rejects supersedes entries that name no existing spec or record", () => {
    const { errors } = run({
      specs: [spec({ supersedes: [OTHER] })],
      records: [record({ supersedes: ["REC-009"] })],
    });
    expect(messages(errors)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(new RegExp(`supersedes.*${OTHER}`)),
        expect.stringMatching(/supersedes.*REC-009/),
      ]),
    );
  });
});

describe("duplicates", () => {
  it("SEED-R8 rejects a duplicated spec id", () => {
    const { errors } = run({
      specs: [spec(), spec({}, [], "docs/specs/002-foo-again.md")],
    });
    expect(messages(errors)).toContainEqual(
      expect.stringMatching(new RegExp(`002-foo-again\\.md:\\d+: .*${KEY}.*001-foo\\.md`)),
    );
  });

  it("SEED-R8 rejects a duplicated record id", () => {
    const { errors } = run({
      records: [record(), record({}, "docs/records/001-same-number.md")],
    });
    expect(messages(errors)).toContainEqual(
      expect.stringMatching(/001-same-number\.md:\d+: .*REC-001/),
    );
  });

  it("SEED-R8 rejects a duplicated requirement id, at the second line", () => {
    const body = [...specBody(), `- **${req(2)}** (unit) The same id again.`];
    const file = spec({}, body);
    const { errors } = run({ specs: [file] });
    expect(errors).toContainEqual({
      path: file.path,
      line: lineOf(file.text, "The same id again"),
      message: expect.stringContaining(req(2)),
    });
  });

  it("SEED-R8 rejects a requirement id whose prefix is not the spec id", () => {
    const body = [...specBody(), `- **${req(5, OTHER)}** (unit) Belongs elsewhere.`];
    const { errors } = run({ specs: [spec({}, body)] });
    expect(messages(errors)).toContainEqual(expect.stringContaining(req(5, OTHER)));
  });

  it("SEED-R8 rejects a duplicated task id", () => {
    const body = [...specBody(), "- [ ] T2 Again"];
    const { errors } = run({ specs: [spec({}, body)] });
    expect(messages(errors)).toContainEqual(expect.stringContaining("T2"));
  });
});

describe("requirement and task lines", () => {
  it.each([
    ["no tag", `- **${req(5)}** The tag is missing.`],
    ["an unknown tag", `- **${req(5)}** (integration) Unknown tag.`],
    ["a tag not in parentheses", `- **${req(5)}** unit Bare tag.`],
    ["a lowercase id", `- **${req(5).toLowerCase()}** (unit) Lowercase.`],
    ["a non-numeric number", `- **${KEY}-Rx** (unit) Not a number.`],
    ["indentation", `  - **${req(5)}** (unit) Indented.`],
    ["a star bullet", `* **${req(5)}** (unit) Star bullet.`],
  ])("SEED-R8 rejects a requirement line with %s, at its line", (_, line) => {
    const file = spec({}, [...specBody(), line]);
    const { errors } = run({ specs: [file] });
    expect(errors).toContainEqual({
      path: file.path,
      line: lineOf(file.text, line),
      message: expect.stringMatching(/malformed requirement/),
    });
  });

  it.each([
    ["an uppercase check mark", "- [X] T3 Upper case"],
    ["an empty box", "- [] T3 Empty box"],
    ["no task id", "- [ ] Something to do"],
    ["no space after the id", "- [ ] T3"],
    ["a lowercase id", "- [ ] t3 Lowercase"],
  ])("SEED-R8 rejects a task line with %s, at its line", (_, line) => {
    const file = spec({}, [...specBody(), line]);
    const { errors } = run({ specs: [file] });
    expect(errors).toContainEqual({
      path: file.path,
      line: lineOf(file.text, line),
      message: expect.stringMatching(/malformed task/),
    });
  });

  it("SEED-R8 leaves prose bullets, links and fenced code alone", () => {
    const body = [
      ...specBody(),
      "- **Bold lead** followed by prose.",
      "- [Linear docs](https://linear.app/docs)",
      "```",
      `- **${req(9)}** inside a fence is an example`,
      "- [ ] an example task",
      "```",
    ];
    expect(messages(run({ specs: [spec({}, body)] }).errors)).toEqual([]);
  });
});

describe("citations", () => {
  it("SEED-R9 fails when a test cites an id that no spec defines, at file:line", () => {
    const tests = [citingAll(), testFile([req(1), req(99)], "apps/web/e2e/landing.ts")];
    const { errors } = run({ tests });
    expect(errors).toEqual([
      {
        path: "apps/web/e2e/landing.ts",
        line: 2,
        message: expect.stringContaining(req(99)),
      },
    ]);
  });

  it("SEED-R9 fails on an undefined citation whatever the spec status", () => {
    for (const status of ["draft", "approved", "implementing", "done", "superseded"]) {
      const { errors } = run({
        specs: [spec({ status })],
        tests: [citingAll(), testFile([req(1, OTHER)])],
      });
      expect(messages(errors), status).toContainEqual(expect.stringContaining(req(1, OTHER)));
    }
  });

  it("SEED-R9 counts a // @req comment as a citation", () => {
    const tests = [
      { path: "a.test.ts", text: `// @req ${req(1)}\n// @req ${req(2)}\nit("works", () => {});` },
    ];
    const { errors, pending } = run({ specs: [spec({ status: "done" })], tests });
    expect(messages(errors)).toEqual([]);
    expect(pending).toEqual([]);
  });

  it("SEED-R9 fails when a done spec has an uncited unit or e2e requirement", () => {
    const file = spec({ status: "done" });
    const { errors, pending } = run({ specs: [file], tests: [testFile([req(1)])] });
    expect(errors).toEqual([
      {
        path: file.path,
        line: lineOf(file.text, `**${req(2)}**`),
        message: expect.stringContaining(req(2)),
      },
    ]);
    expect(pending).toEqual([]);
  });

  it("SEED-R9 lists uncited requirements of a spec that is not done as pending", () => {
    for (const status of ["draft", "approved", "implementing", "superseded"]) {
      const file = spec({ status });
      const { errors, pending } = run({ specs: [file], tests: [] });
      expect(messages(errors), status).toEqual([]);
      expect(pending, status).toEqual([
        {
          id: req(1),
          tag: "unit",
          status,
          path: file.path,
          line: lineOf(file.text, `**${req(1)}**`),
        },
        {
          id: req(2),
          tag: "e2e",
          status,
          path: file.path,
          line: lineOf(file.text, `**${req(2)}**`),
        },
      ]);
    }
  });

  it("SEED-R9 never requires citations for dropped, check or manual requirements", () => {
    const body = [
      `- **${req(1)}** (check) A CI step.`,
      `- **${req(2)}** (manual) A person.`,
      `- **${req(3)}** (dropped) Gone.`,
      "- [ ] T1 Build and check (R1, R2)",
    ];
    const { errors, pending } = run({ specs: [spec({ status: "done" }, body)], tests: [] });
    expect(messages(errors)).toEqual([]);
    expect(pending).toEqual([]);
  });

  it("SEED-R9 accepts citations of a dropped requirement", () => {
    const { errors } = run({ tests: [citingAll(), testFile([req(4)])] });
    expect(messages(errors)).toEqual([]);
  });

  it("SEED-R9 matches whole ids only", () => {
    const tests = [{ path: "a.test.ts", text: `it("x${req(1)} and ${req(1)}0", () => {});` }];
    const { errors, pending } = run({ tests });
    expect(pending.map((p) => p.id)).toContain(req(1));
    expect(messages(errors)).toEqual([expect.stringContaining(req(10))]);
  });
});

describe("task coverage", () => {
  const requirements = [
    `- **${req(1)}** (unit) One.`,
    `- **${req(2)}** (unit) Two.`,
    `- **${req(3)}** (check) Three.`,
    `- **${req(4)}** (manual) Four.`,
    `- **${req(5)}** (dropped) Five.`,
  ];
  const errorsFor = (tasks: string[]) =>
    run({ specs: [spec({}, [...requirements, "", ...tasks])], tests: [] }).errors;

  it("SEED-R30 accepts single ids, lists, ranges and wrapped tasks", () => {
    const tasks = [
      "- [ ] T1 Single (R1)",
      "- [x] T2 A task that wraps over",
      "      an indented continuation line (R2,",
      "      R3)",
      "- [ ] T3 Range and list (R3 to R4, R1)",
    ];
    expect(messages(errorsFor(tasks))).toEqual([]);
  });

  it.each([
    ["no parenthesis", "- [ ] T2 Nothing named"],
    ["a parenthesis that is not ids", "- [ ] T2 Nothing named (manual)"],
    ["a parenthesis that is not at the end", "- [ ] T2 Names (R2) mid-sentence"],
    ["the spec prefix", `- [ ] T2 Prefixed (${req(2)})`],
    ["a backward range", "- [ ] T2 Backward (R3 to R2)"],
  ])("SEED-R30 fails when a task names no requirement: %s, at the task line", (_, line) => {
    const file = spec({}, [...requirements, "", "- [ ] T1 Covers (R1 to R4)", line]);
    const { errors } = run({ specs: [file], tests: [] });
    expect(errors).toEqual([
      { path: file.path, line: lineOf(file.text, line), message: expect.stringContaining("T2") },
    ]);
  });

  it("SEED-R30 ends a task at the first line that is not indented", () => {
    const errors = errorsFor(["- [ ] T1 Covers", "(R1 to R4)"]);
    expect(messages(errors)).toContainEqual(expect.stringMatching(/T1 names no requirement/));
  });

  it("SEED-R30 fails when a requirement not dropped is named by no task, at its line", () => {
    const file = spec({}, [...requirements, "", "- [ ] T1 Some (R1, R3)"]);
    const { errors } = run({ specs: [file], tests: [] });
    expect(errors).toEqual([
      {
        path: file.path,
        line: lineOf(file.text, `**${req(2)}**`),
        message: expect.stringContaining(req(2)),
      },
      {
        path: file.path,
        line: lineOf(file.text, `**${req(4)}**`),
        message: expect.stringContaining(req(4)),
      },
    ]);
  });

  it("SEED-R30 fails when a task names a requirement the spec does not define", () => {
    const errors = errorsFor(["- [ ] T1 All (R1 to R4, R9)"]);
    expect(messages(errors)).toEqual([expect.stringContaining(req(9))]);
  });
});
