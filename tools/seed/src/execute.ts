// Sends a plan through the port (MIRROR-R27). Phases run in order; within a phase a few writes
// run at once. Every write passes the guard against the workspace read before planning, so a
// wrong or tampered plan cannot reach outside the Test hierarchy. On rate limiting all workers
// pause for as long as Linear asks, then retry.
import { type GuardContext, refusal } from "./guard.ts";
import { RateLimitedError, type SeedApi, type Workspace } from "./model.ts";
import { hierarchyOf, type Plan, type PlanEntry, type Step } from "./plan.ts";

export type ExecuteOptions = {
  teamName: string;
  /** Writes in flight at once. Linear asks for modest concurrency. */
  concurrency?: number;
  /** Attempts per write when rate limited, including the first. */
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onStep?: (step: Step, result: "done" | "failed" | "refused" | "skipped", reason?: string) => void;
  onPause?: (ms: number) => void;
};

export type Outcome = {
  done: Step[];
  failed: { step: Step; error: string }[];
  refused: { step: Step; reason: string }[];
  skipped: { step: Step; reason: string }[];
};

export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_MAX_ATTEMPTS = 6;

const isStep = (e: PlanEntry): e is Step => e.op !== "unchanged";

/** The id a step creates, if it creates an entity others may refer to. */
const createdId = (step: Step): string | null =>
  step.op === "create" && step.kind !== "link" ? step.input.id : null;

/** Ids of entities the step refers to, which must exist by the time it is sent. */
function dependsOn(step: Step): string[] {
  if (step.kind === "link") return [step.input.initiativeId, step.input.projectId];
  const input = step.input as { labelIds?: string[]; parentId?: string };
  return [...(input.labelIds ?? []), ...(input.parentId ? [input.parentId] : [])];
}

function send(api: SeedApi, step: Step): Promise<void> {
  switch (step.kind) {
    case "projectLabel":
      return step.op === "create"
        ? api.createProjectLabel(step.input)
        : api.updateProjectLabel(step.id, step.input);
    case "initiativeLabel":
      return step.op === "create"
        ? api.createInitiativeLabel(step.input)
        : api.updateInitiativeLabel(step.id, step.input);
    case "project":
      return step.op === "create"
        ? api.createProject(step.input)
        : api.updateProject(step.id, step.input);
    case "initiative":
      return step.op === "create"
        ? api.createInitiative(step.input)
        : api.updateInitiative(step.id, step.input);
    case "link":
      return api.linkProject(step.input);
  }
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

export async function execute(
  plan: Plan,
  workspace: Workspace,
  api: SeedApi,
  options: ExecuteOptions,
): Promise<Outcome> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const outcome: Outcome = { done: [], failed: [], refused: [], skipped: [] };

  // The guard works from the workspace alone, never from what the plan claims.
  const hierarchy = new Set(hierarchyOf(workspace.teams, options.teamName).teams.map((t) => t.id));
  const ctx: GuardContext = { workspace, hierarchy, created: new Map() };
  const missing = new Set<string>();
  const lose = (step: Step) => {
    const id = createdId(step);
    if (id !== null) missing.add(id);
  };

  let pausedUntil = 0;
  const attempt = async (step: Step) => {
    for (let n = 1; ; n++) {
      for (let wait = pausedUntil - now(); wait > 0; wait = pausedUntil - now()) await sleep(wait);
      try {
        return await send(api, step);
      } catch (error) {
        if (!(error instanceof RateLimitedError) || n >= maxAttempts) throw error;
        if (now() + error.waitMs > pausedUntil) {
          pausedUntil = now() + error.waitMs;
          options.onPause?.(error.waitMs);
        }
      }
    }
  };

  const steps = plan.entries.filter(isStep);
  const phases = [...new Set(steps.map((s) => s.phase))].sort((a, b) => a - b);
  for (const phase of phases) {
    const approved: Step[] = [];
    for (const step of steps.filter((s) => s.phase === phase)) {
      const lost = dependsOn(step).filter((id) => missing.has(id));
      if (lost.length > 0) {
        const reason = `needs ${lost.join(", ")}, which was not created`;
        outcome.skipped.push({ step, reason });
        options.onStep?.(step, "skipped", reason);
        lose(step);
        continue;
      }
      const reason = refusal(step, ctx);
      if (reason !== null) {
        outcome.refused.push({ step, reason });
        options.onStep?.(step, "refused", reason);
        lose(step);
        continue;
      }
      const id = createdId(step);
      if (id !== null) ctx.created.set(id, step);
      approved.push(step);
    }
    await pool(approved, concurrency, async (step) => {
      try {
        await attempt(step);
        outcome.done.push(step);
        options.onStep?.(step, "done");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outcome.failed.push({ step, error: message });
        options.onStep?.(step, "failed", message);
        lose(step);
      }
    });
  }
  return outcome;
}
