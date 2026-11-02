// One run of the seed tool: read the workspace, plan, print, and unless it is a dry run, send
// the plan (MIRROR-R27). Returns the exit code.
import { DEFAULT_CONCURRENCY, execute } from "./execute.ts";
import { DEFAULT_SEED, generateFixtures } from "./fixtures.ts";
import type { SeedApi } from "./model.ts";
import { formatEntry, hierarchyOf, KINDS, type Kind, planSeed, summarize } from "./plan.ts";

export type RunOptions = {
  teamName: string;
  dryRun: boolean;
  verbose: boolean;
  seed?: number;
  concurrency?: number;
  newId?: () => string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log: (line: string) => void;
  error: (line: string) => void;
};

const KIND_NAMES: Record<Kind, string> = {
  projectLabel: "project label",
  initiativeLabel: "initiative label",
  project: "project",
  initiative: "initiative",
  link: "link",
};

/** Seconds per write as observed against Linear's API; only feeds the printed estimate. */
const SECONDS_PER_WRITE = 0.6;

const past = (op: string) => `${op}d`;

export async function runSeed(api: SeedApi, options: RunOptions): Promise<number> {
  const { log, error } = options;
  const workspace = await api.readWorkspace();
  const fixtures = generateFixtures(options.seed ?? DEFAULT_SEED);
  const plan = planSeed(fixtures, workspace, {
    teamName: options.teamName,
    ...(options.newId ? { newId: options.newId } : {}),
  });

  const hierarchy = hierarchyOf(workspace.teams, options.teamName).teams.map((t) => t.key);
  log(
    `seed:fixtures: read ${workspace.teams.length} teams, ${workspace.projects.length} projects, ` +
      `${workspace.initiatives.length} initiatives; hierarchy ${hierarchy.join(", ") || "none"}`,
  );
  for (const w of plan.warnings) error(`warning: ${w}`);
  for (const e of plan.errors) error(`error: ${e}`);
  if (plan.errors.length > 0) {
    error("seed:fixtures: nothing written; fix the errors above and run again.");
    return 1;
  }

  const steps = plan.entries.filter((e) => e.op !== "unchanged");
  for (const entry of plan.entries) {
    if (entry.op === "unchanged") {
      if (options.verbose) log(formatEntry(entry));
    } else if (options.dryRun) {
      log(formatEntry(entry, `would ${entry.op}`));
    }
  }

  const summary = summarize(plan.entries);
  log("Plan:");
  log(
    `  ${"kind".padEnd(18)}${"create".padStart(8)}${"update".padStart(8)}${"unchanged".padStart(11)}`,
  );
  for (const kind of KINDS) {
    const c = summary[kind];
    log(
      `  ${KIND_NAMES[kind].padEnd(18)}${String(c.create).padStart(8)}` +
        `${String(c.update).padStart(8)}${String(c.unchanged).padStart(11)}`,
    );
  }

  if (options.dryRun) {
    log(`Dry run: nothing was written. ${steps.length} writes would be sent.`);
    return 0;
  }
  if (steps.length === 0) {
    log("Nothing to do: every fixture is current.");
    return 0;
  }

  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const minutes = Math.ceil((steps.length * SECONDS_PER_WRITE) / concurrency / 60);
  log(`Sending ${steps.length} writes, ${concurrency} at a time; expect about ${minutes} min.`);
  const outcome = await execute(plan, workspace, api, {
    teamName: options.teamName,
    concurrency,
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.now ? { now: options.now } : {}),
    onPause: (ms) => error(`rate limited: pausing ${Math.ceil(ms / 1000)}s before retrying`),
    onStep: (step, result, reason) => {
      if (result === "done") log(formatEntry(step, past(step.op)));
      else error(`${result} ${formatEntry(step)}: ${reason}`);
    },
  });

  const { done, failed, refused, skipped } = outcome;
  log(
    `Wrote ${done.length}, failed ${failed.length}, refused ${refused.length}, ` +
      `skipped ${skipped.length}.`,
  );
  return failed.length + refused.length + skipped.length > 0 ? 1 : 0;
}
