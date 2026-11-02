import { describe, expect, it } from "vitest";
import { generateFixtures } from "../src/fixtures.ts";
import { runSeed } from "../src/run.ts";
import { fakeLinear } from "./fake.ts";
import { sequentialIds, T, workspace } from "./workspace.ts";

const fixtures = generateFixtures();

function output() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    log: (line: string) => lines.push(line),
    error: (line: string) => errors.push(line),
    text: () => lines.join("\n"),
  };
}

const options = (out: ReturnType<typeof output>, over: object = {}) => ({
  teamName: "Test",
  dryRun: false,
  verbose: false,
  log: out.log,
  error: out.error,
  newId: sequentialIds(),
  ...over,
});

describe("runSeed", () => {
  it("MIRROR-R27 --dry-run prints the plan and a summary and writes nothing", async () => {
    const linear = fakeLinear(workspace());
    const out = output();

    const code = await runSeed(linear.api, options(out, { dryRun: true }));

    expect(code).toBe(0);
    expect(linear.writes).toEqual([]);
    expect(linear.reads()).toBe(1);
    const text = out.text();
    expect(text).toMatch(/^would create project P001 "/m);
    expect(text).toMatch(/^would create initiative I01 "/m);
    expect(text).toMatch(/^would create link I\d\d to P\d{3}$/m);
    expect(text).toMatch(new RegExp(`^ +project +${fixtures.projects.length} +0 +0$`, "m"));
    expect(text).toMatch(/Dry run: nothing was written/);
    expect(out.errors.join("\n")).toMatch(/warning: Ignoring project P001/);
  });

  it("MIRROR-R27 seeds, then a second run updates nothing and creates no duplicate", async () => {
    const linear = fakeLinear(workspace());

    const first = output();
    expect(await runSeed(linear.api, options(first))).toBe(0);
    const written = linear.writes.length;
    expect(written).toBeGreaterThan(fixtures.projects.length + fixtures.initiatives.length);
    expect(first.text()).toMatch(/^created project P001 /m);
    expect(first.text()).toMatch(new RegExp(`Wrote ${written}, failed 0, refused 0, skipped 0`));

    const second = output();
    expect(await runSeed(linear.api, options(second, { newId: sequentialIds("again") }))).toBe(0);
    expect(linear.writes.length).toBe(written);
    expect(second.text()).toMatch(/Nothing to do/);
    expect(second.text()).toMatch(
      new RegExp(`^ +project +0 +0 +${fixtures.projects.length}$`, "m"),
    );
  });

  it("MIRROR-R27 updates a drifted fixture in place on a later run", async () => {
    const linear = fakeLinear(workspace());
    await runSeed(linear.api, options(output()));
    const p = linear.state.projects.find((x) => x.name === fixtures.projects[0]?.name);
    if (!p) throw new Error("no P001");
    p.priority = (p.priority + 1) % 5;
    const before = linear.writes.length;

    const out = output();
    expect(await runSeed(linear.api, options(out, { newId: sequentialIds("again") }))).toBe(0);

    expect(linear.writes.slice(before)).toEqual([{ method: "updateProject", id: p.id }]);
    expect(out.text()).toMatch(/^updated project P001 ".*": priority \d -> \d$/m);
  });

  it("MIRROR-R27 lists unchanged fixtures only with --verbose", async () => {
    const linear = fakeLinear(workspace());
    await runSeed(linear.api, options(output()));
    const out = output();
    await runSeed(linear.api, options(out, { dryRun: true, verbose: true }));
    expect(out.text()).toMatch(/^unchanged project P001 /m);
  });

  it("MIRROR-R27 exits 1 on a plan error before writing anything", async () => {
    const ws = workspace();
    ws.teams = ws.teams.filter((t) => t.id !== T.root);
    const linear = fakeLinear(ws);
    const out = output();

    expect(await runSeed(linear.api, options(out))).toBe(1);
    expect(linear.writes).toEqual([]);
    expect(out.errors.join("\n")).toMatch(/error: No team named or keyed "Test"/);
  });

  it("MIRROR-R27 exits 1 when a write fails and reports it", async () => {
    const linear = fakeLinear(workspace(), { failOn: new Set(["new-1"]) });
    const out = output();

    expect(await runSeed(linear.api, options(out))).toBe(1);
    expect(out.errors.join("\n")).toMatch(/failed .*Linear refused/);
    expect(out.text()).toMatch(/failed 1, refused 0, skipped [1-9]/);
  });
});
