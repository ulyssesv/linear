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

export type Requirement = { key: string; id: string; tag: RequirementTag; line: number };
export type Task = { number: number; line: number };
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
      body.requirements.push({ key, id: `${key}-R${number}`, tag: tag as RequirementTag, line });
    } else if (REQUIREMENT_LIKE.test(raw)) {
      body.malformed.push({ kind: "requirement", line, text: raw.trim() });
    }

    const task = TASK_LINE.exec(raw);
    if (task) {
      body.tasks.push({ number: Number(task[1]), line });
    } else if (TASK_LIKE.test(raw)) {
      body.malformed.push({ kind: "task", line, text: raw.trim() });
    }
  }
  return body;
}
