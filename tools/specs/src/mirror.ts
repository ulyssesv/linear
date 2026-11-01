// What each spec and record becomes in Linear: title, parent and body (SEED-R10, SEED-R11).
import type { Problem, SourceFile } from "./check.ts";
import { parseFrontMatter } from "./parse.ts";

export type ParentKind = "project" | "issue" | "initiative";
/** A Linear entity named by URL: the slug id of a project or initiative, or an issue identifier. */
export type ParentRef = { kind: ParentKind; key: string; url: string };

export type MirrorDoc = {
  /** Source file, relative to the repository root. */
  path: string;
  /** `SPEC-NNN` or `REC-NNN`: how the document is found again. */
  prefix: string;
  title: string;
  parent: ParentRef;
  content: string;
};

/** Where the files come from, for the header line that links back to them. */
export type Source = { repository: string; commit: string };

const LINEAR_PATH = /^\/[^/]+\/(project|issue|initiative)\/([^/]+)/;
const FILE_NUMBER = /\/(\d{3})-[^/]*\.md$/;
const RECORD_ID = /^REC-\d{3}$/;

/** Reads `https://linear.app/<workspace>/<project|issue|initiative>/<slug>`. */
export function parseLinearUrl(url: string): ParentRef | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname !== "linear.app") return undefined;
  const match = LINEAR_PATH.exec(parsed.pathname);
  if (!match) return undefined;
  const kind = match[1] as ParentKind;
  const slug = match[2] ?? "";
  // Projects and initiatives end their slug with the slug id; issues use the identifier.
  const key = kind === "issue" ? slug : slug.slice(slug.lastIndexOf("-") + 1);
  return key === "" ? undefined : { kind, key, url };
}

export function mirrorDocs(
  input: { specs: SourceFile[]; records: SourceFile[] },
  source: Source,
): { docs: MirrorDoc[]; errors: Problem[] } {
  const docs: MirrorDoc[] = [];
  const errors: Problem[] = [];
  const files = [
    ...input.specs.map((file) => ({ file, kind: "spec" as const })),
    ...input.records.map((file) => ({ file, kind: "record" as const })),
  ];
  for (const { file, kind } of files) {
    const result = toMirror(file, kind, source);
    if ("message" in result) errors.push(result);
    else docs.push(result);
  }
  return { docs, errors };
}

function toMirror(file: SourceFile, kind: "spec" | "record", source: Source): MirrorDoc | Problem {
  const fail = (line: number | undefined, message: string): Problem => ({
    path: file.path,
    line,
    message,
  });
  const front = parseFrontMatter(file.text);
  if (!front.ok) return fail(front.line, front.message);
  const { data, lineOf } = front;

  const title = data.title;
  if (typeof title !== "string" || title.trim() === "") {
    return fail(lineOf("title"), "title is missing");
  }

  let prefix: string;
  if (kind === "spec") {
    const number = FILE_NUMBER.exec(`/${file.path}`)?.[1];
    if (!number) return fail(undefined, "file name must start with a three-digit number");
    prefix = `SPEC-${number}`;
  } else {
    if (typeof data.id !== "string" || !RECORD_ID.test(data.id)) {
      return fail(lineOf("id"), "id must be REC-NNN");
    }
    prefix = data.id;
  }

  const linear = (data.linear ?? {}) as Record<string, unknown>;
  const field = kind === "spec" ? "parent" : "initiative";
  const value = linear[field];
  const parent = typeof value === "string" ? parseLinearUrl(value) : undefined;
  const allowed: ParentKind[] = kind === "spec" ? ["project", "issue"] : ["initiative"];
  if (!parent || !allowed.includes(parent.kind)) {
    const wanted = kind === "spec" ? "a Linear project or issue" : "a Linear initiative";
    return fail(lineOf("linear", field), `linear.${field} must be the URL of ${wanted}`);
  }

  const notes = [`Status: **${String(data.status)}**.`];
  if (kind === "record" && typeof data.spec === "string") notes.push(`Spec: ${data.spec}.`);
  const header =
    `> Mirror of \`${file.path}\` in ` +
    `[${source.repository}](https://github.com/${source.repository}/blob/${source.commit}/${file.path}) ` +
    `at commit \`${source.commit.slice(0, 7)}\`. The file is the source of truth. ${notes.join(" ")}`;

  const body = mirrorBody(file.text.split("\n").slice(front.bodyStart), title);
  return {
    path: file.path,
    prefix,
    title: `${prefix} ${title}`,
    parent,
    content: `${header}\n\n${body}`,
  };
}

/** The body lines with surrounding blank lines trimmed and a leading H1 that repeats the title dropped. */
function mirrorBody(lines: string[], title: string): string {
  let start = lines.findIndex((line) => line.trim() !== "");
  if (start === -1) return "";
  const heading = /^# (.+)$/.exec(lines[start] ?? "")?.[1]?.trim();
  if (heading?.endsWith(title.trim())) {
    start++;
    while (start < lines.length && lines[start]?.trim() === "") start++;
  }
  return `${lines.slice(start).join("\n").trimEnd()}\n`;
}
