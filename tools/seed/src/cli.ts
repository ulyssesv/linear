// Usage: node src/cli.ts [--dry-run] [--verbose] [--team <name or key>] [--concurrency <n>]
// Seeds the planning sheet fixtures under the Test team hierarchy (MIRROR-R27).
import { parseArgs } from "node:util";
import { DEFAULT_CONCURRENCY } from "./execute.ts";
import { linearApi } from "./linear.ts";
import { runSeed } from "./run.ts";

const HELP = `Usage: pnpm seed:fixtures [--dry-run] [--verbose] [--team <name or key>] [--concurrency <n>]

Seeds the planning sheet fixtures (spec MIRROR, MIRROR-R27) under the Test team and its
public sub-teams: 320 projects and 64 initiatives across every status, several leads,
dates, priorities and the "Fixture ..." label groups, with initiatives linked to projects.

Runs are idempotent. Fixtures are found by the "seed-fixture:<key>" line in their
description: missing ones are created, drifted fields updated, current ones left alone.
The tool never deletes anything, never creates or alters teams, and never writes to a
project outside the Test hierarchy, an initiative without the marker, or a label outside
the "Fixture " groups. Private teams (such as SBX) are never part of the hierarchy.

Options:
  --dry-run          Read the workspace, print the plan and a summary, write nothing.
  --verbose          Also list fixtures that are already current.
  --team <name>      Root team, by name or key. Default: Test.
  --concurrency <n>  Writes in flight at once. Default: ${DEFAULT_CONCURRENCY}.
  --help             Show this help.

Needs LINEAR_API_KEY, a Linear personal API key with write access. This is a developer
tool run by hand on a local machine, so it uses the personal key; the server itself never
uses one (MIRROR-R2). A first run sends about 700 writes and takes a few minutes; a run with
nothing to change sends about 15 reads and no writes. On rate limiting the tool pauses for
as long as Linear asks and carries on.
`;

const OPTIONS = {
  "dry-run": { type: "boolean", default: false },
  verbose: { type: "boolean", default: false },
  team: { type: "string", default: "Test" },
  concurrency: { type: "string", default: String(DEFAULT_CONCURRENCY) },
  help: { type: "boolean", default: false },
} as const;

const values = (() => {
  try {
    return parseArgs({ options: OPTIONS }).values;
  } catch (error) {
    console.error(`seed:fixtures: ${error instanceof Error ? error.message : String(error)}`);
    console.error(HELP);
    process.exit(2);
  }
})();

if (values.help) {
  console.log(HELP);
  process.exit(0);
}
const concurrency = Number(values.concurrency);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
  console.error("seed:fixtures: --concurrency takes a whole number from 1 to 10");
  process.exit(2);
}

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) {
  console.error(
    "seed:fixtures: LINEAR_API_KEY is not set. Create a personal API key in Linear " +
      "(Settings, Security & access) and export it in this shell only.",
  );
  process.exit(1);
}

try {
  process.exitCode = await runSeed(linearApi(apiKey), {
    teamName: values.team,
    dryRun: values["dry-run"],
    verbose: values.verbose,
    concurrency,
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
} catch (error) {
  console.error(`seed:fixtures: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
