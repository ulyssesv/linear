// Usage: node src/sync-cli.ts [repository root] [--dry-run]
// Mirrors specs and records to Linear documents (SEED-R10, SEED-R11). With --dry-run it reads
// from Linear but writes nothing, and prints every create and update it would perform (SEED-R13).
// Needs LINEAR_API_KEY. The commit and repository come from GITHUB_SHA and GITHUB_REPOSITORY
// when set (CI), otherwise from git HEAD and the default repository.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Problem } from "./check.ts";
import { linearApi } from "./linear.ts";
import { mirrorDocs } from "./mirror.ts";
import { collectDocs } from "./scan.ts";
import { formatAction, sync } from "./sync.ts";

const DEFAULT_REPOSITORY = "ulyssesv/linear";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { "dry-run": { type: "boolean", default: false } },
});
const root = resolve(positionals[0] ?? ".");
const dryRun = values["dry-run"];

const printProblem = (p: Problem) => {
  console.error(`${p.path}${p.line === undefined ? "" : `:${p.line}`}: ${p.message}`);
};

const commit =
  process.env.GITHUB_SHA ||
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;

const { docs, errors } = mirrorDocs(await collectDocs(root), { repository, commit });
for (const error of errors) printProblem(error);

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) {
  console.error(
    "linear:sync: LINEAR_API_KEY is not set. Create a Linear personal API key and, for CI, " +
      "store it as the LINEAR_API_KEY repository secret (SEED T11, LIN-11).",
  );
  process.exit(1);
}

if (dryRun) console.log("Dry run: reading from Linear, writing nothing.");
const result = await sync(docs, linearApi(apiKey), {
  dryRun,
  onAction: (action) => console.log(formatAction(action, dryRun)),
});
for (const error of result.errors) printProblem(error);

const failed = errors.length + result.errors.length;
const creates = result.actions.filter((a) => a.kind === "create").length;
const updates = result.actions.length - creates;
console.log(
  `linear:sync${dryRun ? " (dry run)" : ""}: ${docs.length} documents at ${commit.slice(0, 7)}; ` +
    (dryRun
      ? `${creates} to create, ${updates} to update`
      : `${creates} created, ${updates} updated`) +
    `, ${failed} failed`,
);
process.exitCode = failed > 0 ? 1 : 0;
