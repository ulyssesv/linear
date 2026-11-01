import {
  type Body,
  type FrontMatter,
  parseBody,
  parseFrontMatter,
  REQUIREMENT_TAGS,
  type RequirementTag,
} from "./parse.ts";

export const SPEC_STATUSES = ["draft", "approved", "implementing", "done", "superseded"];
export const RECORD_STATUSES = ["proposed", "accepted", "retired", "superseded"];
export const AREAS = ["site-platform", "planning-sheet", "metrics-rollup", "ai-sdlc", "infra"];

const SPEC_ID = /^[A-Z][A-Z0-9]*$/;
const RECORD_ID = /^REC-(\d{3})$/;
const FILE_NAME = /^(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A requirement id anywhere in a test file: in a test name or a `// @req` comment. */
const CITATION = /\b[A-Z][A-Z0-9]*-R\d+\b/g;
const CITED_TAGS: RequirementTag[] = ["unit", "e2e"];

/** A file's path relative to the repository root, with forward slashes, and its contents. */
export type SourceFile = { path: string; text: string };
export type CheckInput = { specs: SourceFile[]; records: SourceFile[]; tests: SourceFile[] };
export type Problem = { path: string; line: number | undefined; message: string };
export type Pending = {
  id: string;
  tag: RequirementTag;
  status: string;
  path: string;
  line: number;
};
export type CheckResult = { errors: Problem[]; pending: Pending[] };

type Parsed = {
  file: SourceFile;
  /** File number from the name, when the name is well formed. */
  number: string | undefined;
  front: FrontMatter;
  body: Body;
  id: string | undefined;
  status: string | undefined;
  supersedes: string[];
};

export function check(input: CheckInput): CheckResult {
  const errors: Problem[] = [];
  const report = (path: string, line: number | undefined, message: string) => {
    errors.push({ path, line, message });
  };

  const specs = input.specs.map((file) => parse(file, report));
  const records = input.records.map((file) => parse(file, report));
  for (const spec of specs) validateSpec(spec, report);
  for (const record of records) validateRecord(record, report);

  const specIds = uniqueIds(specs, "spec", report);
  const recordIds = uniqueIds(records, "record", report);

  for (const spec of specs) checkSupersedes(spec, specIds, "spec", report);
  for (const record of records) {
    checkSupersedes(record, recordIds, "record", report);
    if (record.front.ok) {
      const name = record.front.data.spec;
      if (typeof name === "string" && !specIds.has(name)) {
        report(record.file.path, record.front.lineOf("spec"), `spec ${name} names no spec`);
      }
    }
  }

  // Requirement and task lines. Only the first definition of a requirement id counts.
  const defined = new Map<string, { spec: Parsed; tag: RequirementTag; line: number }>();
  for (const spec of specs) {
    const { path } = spec.file;
    for (const bad of spec.body.malformed) {
      const expected =
        bad.kind === "requirement"
          ? `- **<ID>-R<n>** (${REQUIREMENT_TAGS.join("|")}) ...`
          : "- [ ] T<n> ... or - [x] T<n> ...";
      report(path, bad.line, `malformed ${bad.kind} line, expected "${expected}": ${bad.text}`);
    }
    for (const requirement of spec.body.requirements) {
      if (spec.id !== undefined && requirement.key !== spec.id) {
        report(
          path,
          requirement.line,
          `requirement ${requirement.id} does not belong to spec ${spec.id}; its ids start with ${spec.id}-R`,
        );
      }
      const first = defined.get(requirement.id);
      if (first) {
        report(
          path,
          requirement.line,
          `duplicate requirement id ${requirement.id}, first defined at ${first.spec.file.path}:${first.line}`,
        );
        continue;
      }
      defined.set(requirement.id, { spec, tag: requirement.tag, line: requirement.line });
    }
    const tasks = new Map<number, number>();
    for (const task of spec.body.tasks) {
      const first = tasks.get(task.number);
      if (first !== undefined) {
        report(path, task.line, `duplicate task id T${task.number}, first at line ${first}`);
      } else {
        tasks.set(task.number, task.line);
      }
    }

    // Tasks and requirements name each other.
    const numbers = new Set(spec.body.requirements.map((requirement) => requirement.number));
    const named = new Set<number>();
    for (const task of spec.body.tasks) {
      if (task.names === undefined) {
        report(
          path,
          task.line,
          `task T${task.number} names no requirement; end it with the ids it covers, like (R1, R2) or (R1 to R3)`,
        );
        continue;
      }
      for (const n of task.names) {
        named.add(n);
        if (!numbers.has(n)) {
          report(
            path,
            task.line,
            `task T${task.number} names ${spec.id ?? "?"}-R${n}, which this spec does not define`,
          );
        }
      }
    }
    for (const requirement of spec.body.requirements) {
      if (requirement.tag !== "dropped" && !named.has(requirement.number)) {
        report(path, requirement.line, `${requirement.id} is named by no task`);
      }
    }
  }

  // Citations.
  const cited = new Set<string>();
  for (const test of input.tests) {
    test.text.split("\n").forEach((text, index) => {
      for (const [id] of text.matchAll(CITATION)) {
        cited.add(id);
        if (!defined.has(id)) report(test.path, index + 1, `cites ${id}, which no spec defines`);
      }
    });
  }

  const pending: Pending[] = [];
  for (const [id, { spec, tag, line }] of defined) {
    if (!CITED_TAGS.includes(tag) || cited.has(id)) continue;
    if (spec.status === "done") {
      report(
        spec.file.path,
        line,
        `${id} (${tag}) is cited by no test, and spec ${spec.id} is done`,
      );
    } else {
      pending.push({ id, tag, status: spec.status ?? "unknown", path: spec.file.path, line });
    }
  }

  errors.sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
  return { errors, pending };
}

type Report = (path: string, line: number | undefined, message: string) => void;

function parse(file: SourceFile, report: Report): Parsed {
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  const number = FILE_NAME.exec(name)?.[1];
  if (number === undefined)
    report(file.path, undefined, `file name ${name} is not shaped NNN-slug.md`);

  const front = parseFrontMatter(file.text);
  if (!front.ok) report(file.path, front.line, front.message);
  return {
    file,
    number,
    front,
    body: parseBody(file.text, front.bodyStart),
    id: undefined,
    status: undefined,
    supersedes: [],
  };
}

/** Typed accessors over front matter that report what is missing or invalid. */
function fields(parsed: Parsed, report: Report) {
  const { front, file } = parsed;
  if (!front.ok) return undefined;

  const get = (path: string[]): unknown =>
    path.reduce<unknown>(
      (value, key) =>
        value !== null && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      front.data,
    );
  const line = (path: string[]): number => {
    for (let n = path.length; n > 0; n--) {
      if (get(path.slice(0, n)) !== undefined) return front.lineOf(...path.slice(0, n));
    }
    return 1;
  };
  const fail = (path: string[], message: string) => report(file.path, line(path), message);

  const string = (path: string[], optional = false): string | undefined => {
    const value = get(path);
    const name = path.join(".");
    if (value === undefined || value === null) {
      if (!optional) fail(path, `${name} is required`);
      return undefined;
    }
    if (typeof value !== "string" || value.trim() === "") {
      fail(path, `${name} must be a non-empty string`);
      return undefined;
    }
    return value;
  };

  return {
    string,
    oneOf(path: string[], allowed: string[]): string | undefined {
      const value = string(path);
      if (value !== undefined && !allowed.includes(value)) {
        fail(path, `${path.join(".")} must be one of ${allowed.join(", ")} (got "${value}")`);
        return undefined;
      }
      return value;
    },
    matching(path: string[], pattern: RegExp, description: string): string | undefined {
      const value = string(path);
      if (value !== undefined && !pattern.test(value)) {
        fail(path, `${path.join(".")} must be ${description} (got "${value}")`);
        return undefined;
      }
      return value;
    },
    date(path: string[]): void {
      const value = string(path);
      if (value !== undefined && (!DATE.test(value) || Number.isNaN(Date.parse(value)))) {
        fail(path, `${path.join(".")} must be a date shaped YYYY-MM-DD (got "${value}")`);
      }
    },
    linearUrl(path: string[], kinds: string[], optional = false): void {
      const value = string(path, optional);
      if (value !== undefined && !isLinearUrl(value, kinds)) {
        fail(path, `${path.join(".")} must be a Linear ${kinds.join(" or ")} URL (got "${value}")`);
      }
    },
    list(path: string[]): string[] {
      const value = get(path);
      if (value === undefined || value === null) {
        fail(path, `${path.join(".")} is required; use [] when empty`);
        return [];
      }
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        fail(path, `${path.join(".")} must be a list of ids`);
        return [];
      }
      return value;
    },
  };
}

function isLinearUrl(value: string, kinds: string[]): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && kinds.some((kind) => url.pathname.includes(`/${kind}/`));
  } catch {
    return false;
  }
}

function validateSpec(spec: Parsed, report: Report): void {
  const f = fields(spec, report);
  if (!f) return;
  spec.id = f.matching(["id"], SPEC_ID, "an uppercase key like SEED");
  f.string(["title"]);
  spec.status = f.oneOf(["status"], SPEC_STATUSES);
  f.oneOf(["area"], AREAS);
  f.linearUrl(["linear", "initiative"], ["initiative"]);
  f.linearUrl(["linear", "parent"], ["project", "issue"]);
  f.linearUrl(["linear", "document"], ["document"], true);
  spec.supersedes = f.list(["supersedes"]);
  f.date(["created"]);
}

function validateRecord(record: Parsed, report: Report): void {
  const f = fields(record, report);
  if (!f) return;
  record.id = f.matching(["id"], RECORD_ID, "shaped REC-NNN");
  if (
    record.id !== undefined &&
    record.number !== undefined &&
    record.id !== `REC-${record.number}`
  ) {
    report(
      record.file.path,
      record.front.ok ? record.front.lineOf("id") : undefined,
      `id ${record.id} does not match the file number ${record.number}`,
    );
  }
  f.string(["title"]);
  record.status = f.oneOf(["status"], RECORD_STATUSES);
  f.date(["date"]);
  f.oneOf(["area"], AREAS);
  f.string(["spec"], true);
  f.linearUrl(["linear", "initiative"], ["initiative"]);
  f.linearUrl(["linear", "document"], ["document"], true);
  record.supersedes = f.list(["supersedes"]);
}

function uniqueIds(docs: Parsed[], kind: string, report: Report): Set<string> {
  const seen = new Map<string, string>();
  for (const doc of docs) {
    if (doc.id === undefined) continue;
    const first = seen.get(doc.id);
    if (first !== undefined) {
      const line = doc.front.ok ? doc.front.lineOf("id") : undefined;
      report(doc.file.path, line, `duplicate ${kind} id ${doc.id}, also defined in ${first}`);
    } else {
      seen.set(doc.id, doc.file.path);
    }
  }
  return new Set(seen.keys());
}

function checkSupersedes(doc: Parsed, ids: Set<string>, kind: string, report: Report): void {
  if (!doc.front.ok) return;
  for (const id of doc.supersedes) {
    if (!ids.has(id)) {
      report(
        doc.file.path,
        doc.front.lineOf("supersedes"),
        `supersedes names ${id}, which is not a ${kind} id`,
      );
    }
  }
}
