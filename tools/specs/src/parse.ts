import { isMap, LineCounter, parseDocument } from "yaml";

export const REQUIREMENT_TAGS = ["unit", "e2e", "check", "manual", "dropped"] as const;
export type RequirementTag = (typeof REQUIREMENT_TAGS)[number];

/** The exact shape of a requirement line, from the spec format. */
export const REQUIREMENT_LINE =
  /^- \*\*([A-Z][A-Z0-9]*)-R(\d+)\*\* \((unit|e2e|check|manual|dropped)\)/;
/** Bulleted bold text that starts like a requirement id; must then match REQUIREMENT_LINE. */
const REQUIREMENT_LIKE = /^\s*[-*+]\s+\*\*[A-Za-z][A-Za-z0-9]*-[Rr]/;

/** The exact shape of a task line, from the spec format. */
export const TASK_LINE = /^- \[[ x]\] T(\d+) /;
/** A bullet with a checkbox (`[ ]`, `[x]`, `[]`, ...); must then match TASK_LINE. Links are not checkboxes. */
const TASK_LIKE = /^\s*[-*+]\s+\[.?\]/;
/** An indented, non-empty line that continues the task item above it. */
const CONTINUATION = /^\s+\S/;
/** The parenthesis that ends a task item, and one entry in it: `R8` or `R1 to R6`. */
const TRAILING_PARENTHESIS = /\(([^()]*)\)\s*$/;
const NAME = /^R(\d+)(?: to R(\d+))?$/;

const FENCE = /^\s*(```|~~~)/;

export type FrontMatter =
  | {
      ok: true;
      data: Record<string, unknown>;
      /** 1-based line of the value at `path` in the file, or of the opening `---` if absent. */
      lineOf: (...path: string[]) => number;
      /** 0-based index of the first line after the closing `---`. */
      bodyStart: number;
    }
  | { ok: false; line: number; message: string; bodyStart: number };

export function parseFrontMatter(text: string): FrontMatter {
  const lines = text.split("\n");
  if (lines[0]?.trimEnd() !== "---") {
    return {
      ok: false,
      line: 1,
      message: "missing front matter: the file must start with ---",
      bodyStart: 0,
    };
  }
  const close = lines.findIndex((line, i) => i > 0 && line.trimEnd() === "---");
  if (close === -1) {
    return { ok: false, line: 1, message: "front matter is not closed with ---", bodyStart: 0 };
  }

  const source = lines.slice(1, close).join("\n");
  const counter = new LineCounter();
  const doc = parseDocument(source, { lineCounter: counter, prettyErrors: false });
  const error = doc.errors[0];
  if (error) {
    const line = counter.linePos(error.pos[0]).line + 1;
    return {
      ok: false,
      line,
      message: `front matter is not valid YAML: ${error.message}`,
      bodyStart: close + 1,
    };
  }
  const data: unknown = doc.toJS();
  if (!isMap(doc.contents) || data === null || typeof data !== "object") {
    return {
      ok: false,
      line: 1,
      message: "front matter must be a YAML mapping",
      bodyStart: close + 1,
    };
  }

  const lineOf = (...path: string[]): number => {
    const node = doc.getIn(path, true) as { range?: [number, number, number] } | undefined;
    const offset = node?.range?.[0];
    return offset === undefined ? 1 : counter.linePos(offset).line + 1;
  };
  return { ok: true, data: data as Record<string, unknown>, lineOf, bodyStart: close + 1 };
}

export type Requirement = {
  key: string;
  id: string;
  number: number;
  tag: RequirementTag;
  line: number;
};
/** `names` holds the requirement numbers the task covers, or is undefined when it names none. */
export type Task = { number: number; line: number; names: number[] | undefined };
export type Malformed = { kind: "requirement" | "task"; line: number; text: string };

export type Body = { requirements: Requirement[]; tasks: Task[]; malformed: Malformed[] };

/** Reads requirement and task lines from the body, skipping fenced code blocks. */
export function parseBody(text: string, bodyStart: number): Body {
  const body: Body = { requirements: [], tasks: [], malformed: [] };
  const lines = text.split("\n");
  let fenced = false;

  for (let i = bodyStart; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = i + 1;
    if (FENCE.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const requirement = REQUIREMENT_LINE.exec(raw);
    if (requirement) {
      const [, key = "", number = "", tag = ""] = requirement;
      body.requirements.push({
        key,
        id: `${key}-R${number}`,
        number: Number(number),
        tag: tag as RequirementTag,
        line,
      });
    } else if (REQUIREMENT_LIKE.test(raw)) {
      body.malformed.push({ kind: "requirement", line, text: raw.trim() });
    }

    const task = TASK_LINE.exec(raw);
    if (task) {
      let end = i + 1;
      while (CONTINUATION.test(lines[end] ?? "")) end++;
      const item = lines.slice(i, end).map((part) => part.trim());
      body.tasks.push({ number: Number(task[1]), line, names: parseNames(item.join(" ")) });
    } else if (TASK_LIKE.test(raw)) {
      body.malformed.push({ kind: "task", line, text: raw.trim() });
    }
  }
  return body;
}

/** Reads the requirement numbers from the parenthesis that ends a task item. */
function parseNames(item: string): number[] | undefined {
  const inner = TRAILING_PARENTHESIS.exec(item)?.[1];
  if (inner === undefined) return undefined;
  const names: number[] = [];
  for (const entry of inner.split(",")) {
    const [, from, to = from] = NAME.exec(entry.trim()) ?? [];
    if (from === undefined || Number(to) < Number(from)) return undefined;
    for (let n = Number(from); n <= Number(to); n++) names.push(n);
  }
  return names;
}
