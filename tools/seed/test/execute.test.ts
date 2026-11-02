import { describe, expect, it } from "vitest";
import { execute } from "../src/execute.ts";
import { generateFixtures, LABEL_PREFIX } from "../src/fixtures.ts";
import type { SeedApi } from "../src/model.ts";
import { type Plan, type PlanEntry, planSeed, type Step } from "../src/plan.ts";
import { fakeLinear } from "./fake.ts";
import { OUTSIDERS, sequentialIds, T, workspace } from "./workspace.ts";

const fixtures = generateFixtures();
const TEAM = "Test";
const outsiderIds = new Set(Object.values(OUTSIDERS));
const isStep = (e: PlanEntry): e is Step => e.op !== "unchanged";

function fakeClock() {
  let t = 0;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    slept,
  };
}

function planFor(api: { state: ReturnType<typeof workspace> }) {
  return planSeed(fixtures, api.state, { teamName: TEAM, newId: sequentialIds() });
}

describe("execute", () => {
  it("MIRROR-R27 applies the plan, and planning again finds nothing to do", async () => {
    const linear = fakeLinear(workspace());
    const plan = planFor(linear);

    const outcome = await execute(plan, linear.state, linear.api, { teamName: TEAM });

    expect(outcome.failed).toEqual([]);
    expect(outcome.refused).toEqual([]);
    expect(outcome.done.length).toBe(plan.entries.filter(isStep).length);
    expect(linear.writes.length).toBe(outcome.done.length);
    expect(linear.state.projects.length).toBe(
      workspace().projects.length + fixtures.projects.length,
    );

    const again = planSeed(fixtures, linear.state, { teamName: TEAM, newId: sequentialIds("x") });
    expect(again.entries.filter(isStep)).toEqual([]);
  });

  it("MIRROR-R27 MIRROR-R28 never writes to an entity outside the hierarchy", async () => {
    const linear = fakeLinear(workspace());
    await execute(planFor(linear), linear.state, linear.api, { teamName: TEAM });

    for (const w of linear.writes) {
      for (const id of w.id.split(">")) expect(outsiderIds.has(id)).toBe(false);
    }
    const untouched = workspace();
    for (const id of [
      OUTSIDERS.linCollidingName,
      OUTSIDERS.linMarked,
      OUTSIDERS.sbxMarked,
      OUTSIDERS.mixedMarked,
    ]) {
      expect(linear.state.projects.find((p) => p.id === id)).toEqual(
        untouched.projects.find((p) => p.id === id),
      );
    }
    expect(linear.state.teams).toEqual(untouched.teams);
    expect(linear.state.initiatives.slice(0, 2)).toEqual(untouched.initiatives);
    for (const p of linear.state.projects.filter((x) => !outsiderIds.has(x.id))) {
      expect(p.teamIds.every((id) => [T.root, T.tam, T.tmg, T.tmb].includes(id))).toBe(true);
    }
  });

  it("MIRROR-R27 runs the phases in order: groups, labels, projects and initiatives, links", async () => {
    const linear = fakeLinear(workspace());
    await execute(planFor(linear), linear.state, linear.api, { teamName: TEAM, concurrency: 8 });

    const rank = (method: string) =>
      method.endsWith("Label") ? 0 : method === "linkProject" ? 2 : 1;
    const ranks = linear.writes.map((w) => rank(w.method));
    expect(ranks).toEqual([...ranks].sort());
    const groups = new Set(linear.state.projectLabels.filter((l) => l.isGroup).map((l) => l.id));
    const firstChild = linear.writes.findIndex(
      (w) => w.method === "createProjectLabel" && !groups.has(w.id),
    );
    const lastGroup = linear.writes.findLastIndex(
      (w) => w.method === "createProjectLabel" && groups.has(w.id),
    );
    expect(lastGroup).toBeLessThan(firstChild);
  });

  it("MIRROR-R27 refuses tampered steps aimed outside the hierarchy and sends none of them", async () => {
    const linear = fakeLinear(workspace());
    const meta = { key: "X", title: "tampered", phase: 2, fields: [], detail: "" };
    const tampered: Step[] = [
      {
        kind: "project",
        op: "update",
        id: OUTSIDERS.linCollidingName,
        input: { name: "x" },
        ...meta,
      },
      { kind: "project", op: "update", id: OUTSIDERS.linMarked, input: { priority: 1 }, ...meta },
      { kind: "project", op: "update", id: OUTSIDERS.sbxMarked, input: { priority: 1 }, ...meta },
      { kind: "project", op: "update", id: OUTSIDERS.mixedMarked, input: { priority: 1 }, ...meta },
      {
        kind: "initiative",
        op: "update",
        id: OUTSIDERS.realInitiative,
        input: { priority: 1 },
        ...meta,
      },
      {
        kind: "projectLabel",
        op: "update",
        id: OUTSIDERS.realProjectGroup,
        input: { color: "#fff" },
        ...meta,
      },
      {
        kind: "link",
        op: "create",
        input: { initiativeId: OUTSIDERS.realInitiative, projectId: OUTSIDERS.linCollidingName },
        ...meta,
      },
    ];
    const plan: Plan = { entries: tampered, warnings: [], errors: [] };

    const outcome = await execute(plan, linear.state, linear.api, { teamName: TEAM });

    expect(outcome.refused.length).toBe(tampered.length);
    expect(outcome.done).toEqual([]);
    expect(linear.writes).toEqual([]);
  });

  it("MIRROR-R27 pauses on rate limiting for as long as Linear asks, then retries", async () => {
    const linear = fakeLinear(workspace(), { rateLimit: { times: 3, waitMs: 30_000 } });
    const clock = fakeClock();
    const plan = planFor(linear);
    const paused: number[] = [];

    const outcome = await execute(plan, linear.state, linear.api, {
      teamName: TEAM,
      concurrency: 1,
      ...clock,
      onPause: (ms) => paused.push(ms),
    });

    expect(outcome.failed).toEqual([]);
    expect(paused).toEqual([30_000, 30_000, 30_000]);
    expect(clock.slept.reduce((a, b) => a + b, 0)).toBe(90_000);
    expect(linear.writes.length).toBe(plan.entries.filter(isStep).length);
  });

  it("MIRROR-R27 gives up on a step after the last attempt and reports it as failed", async () => {
    const linear = fakeLinear(workspace(), { rateLimit: { times: 1_000, waitMs: 1_000 } });
    const plan: Plan = { ...planFor(linear) };
    plan.entries = plan.entries.filter((e) => e.kind === "projectLabel").slice(0, 1);

    const outcome = await execute(plan, linear.state, linear.api, {
      teamName: TEAM,
      maxAttempts: 3,
      ...fakeClock(),
    });

    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]?.error).toMatch(/rate limited/);
  });

  it("MIRROR-R27 skips steps that depend on a create that failed", async () => {
    const plan = planFor(fakeLinear(workspace()));
    const theme = plan.entries.find(
      (e): e is Step =>
        e.op === "create" && e.kind === "projectLabel" && e.key === `${LABEL_PREFIX}Theme`,
    );
    if (theme?.kind !== "projectLabel" || theme.op !== "create") throw new Error("no theme");
    const linear = fakeLinear(workspace(), { failOn: new Set([theme.input.id]) });

    const outcome = await execute(plan, linear.state, linear.api, { teamName: TEAM });

    expect(outcome.failed.map((f) => f.step.key)).toEqual([`${LABEL_PREFIX}Theme`]);
    const skipped = outcome.skipped.map((s) => s.step);
    expect(skipped.filter((s) => s.kind === "projectLabel")).toHaveLength(5);
    expect(skipped.some((s) => s.kind === "project")).toBe(true);
    expect(skipped.some((s) => s.kind === "link")).toBe(true);
    expect(skipped.some((s) => s.kind === "initiative")).toBe(false);
    expect(linear.writes.some((w) => w.method === "createInitiative")).toBe(true);
  });

  it("MIRROR-R27 keeps at most the configured number of writes in flight", async () => {
    const linear = fakeLinear(workspace());
    let inFlight = 0;
    let peak = 0;
    const api = new Proxy(linear.api, {
      get(target, prop: keyof SeedApi) {
        const fn = target[prop] as (...args: unknown[]) => Promise<unknown>;
        return async (...args: unknown[]) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 0));
          try {
            return await fn(...args);
          } finally {
            inFlight--;
          }
        };
      },
    });

    await execute(planFor(linear), linear.state, api, { teamName: TEAM, concurrency: 3 });

    expect(peak).toBe(3);
  });
});
