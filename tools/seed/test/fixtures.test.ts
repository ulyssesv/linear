import { describe, expect, it } from "vitest";
import {
  descriptionFor,
  fixtureKeyOf,
  generateFixtures,
  LABEL_PREFIX,
  MARKER,
} from "../src/fixtures.ts";
import { INITIATIVE_STATUSES, PROJECT_STATUS_TYPES } from "../src/model.ts";

const fixtures = generateFixtures();

describe("generateFixtures", () => {
  it("MIRROR-R27 is deterministic: the same seed gives the same fixture set", () => {
    expect(generateFixtures()).toEqual(fixtures);
    expect(generateFixtures(7)).not.toEqual(fixtures);
  });

  it("MIRROR-R27 has at least three hundred projects and sixty initiatives with unique keys", () => {
    expect(fixtures.projects.length).toBeGreaterThanOrEqual(300);
    expect(fixtures.initiatives.length).toBeGreaterThanOrEqual(60);
    const keys = [...fixtures.projects, ...fixtures.initiatives].map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    const names = fixtures.projects.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("MIRROR-R27 spans every project status type and every initiative status", () => {
    expect(new Set(fixtures.projects.map((p) => p.statusType))).toEqual(
      new Set(PROJECT_STATUS_TYPES),
    );
    expect(new Set(fixtures.initiatives.map((i) => i.status))).toEqual(
      new Set(INITIATIVE_STATUSES),
    );
  });

  it("MIRROR-R27 uses several leads and owners, and leaves some unassigned", () => {
    const leads = new Set(fixtures.projects.map((p) => p.leadSlot));
    expect(leads.has(null)).toBe(true);
    expect([...leads].filter((l) => l !== null).length).toBeGreaterThanOrEqual(4);
    const owners = new Set(fixtures.initiatives.map((i) => i.ownerSlot));
    expect(owners.has(null)).toBe(true);
    expect(owners.size).toBeGreaterThanOrEqual(4);
  });

  it("MIRROR-R27 covers every priority and both set and empty dates", () => {
    expect(new Set(fixtures.projects.map((p) => p.priority))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(new Set(fixtures.initiatives.map((i) => i.priority))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(fixtures.projects.some((p) => p.startDate === null)).toBe(true);
    expect(fixtures.projects.some((p) => p.targetDate === null)).toBe(true);
    expect(fixtures.projects.some((p) => p.startDate && p.targetDate)).toBe(true);
    expect(fixtures.initiatives.some((i) => i.targetDate === null)).toBe(true);
    for (const i of fixtures.initiatives) {
      const [, q, year] = /Q(\d) (\d{4})$/.exec(i.name) ?? [];
      const end = { 1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31" }[Number(q) as 1 | 2 | 3 | 4];
      if (i.targetDate) expect(i.targetDate).toBe(`${year}-${end}`);
    }
    for (const p of fixtures.projects) {
      if (p.startDate && p.targetDate) expect(p.startDate < p.targetDate).toBe(true);
      for (const d of [p.startDate, p.targetDate]) if (d) expect(d).toMatch(/^\d{4}-\d\d-\d\d$/);
    }
  });

  it("MIRROR-R27 places projects in the parent team, in each sub-team and in several teams", () => {
    const single = fixtures.projects.filter((p) => p.teamSlots.length === 1);
    expect(new Set(single.map((p) => p.teamSlots[0]))).toEqual(new Set([0, 1, 2, 3]));
    const multi = fixtures.projects.filter((p) => p.teamSlots.length > 1);
    expect(multi.length).toBeGreaterThanOrEqual(30);
    expect(multi.some((p) => p.teamSlots.length >= 3)).toBe(true);
    for (const p of fixtures.projects) expect(new Set(p.teamSlots).size).toBe(p.teamSlots.length);
  });

  it("MIRROR-R27 owns its label groups by name prefix, with single- and multi-select groups", () => {
    const groups = [...fixtures.projectLabelGroups, ...fixtures.initiativeLabelGroups];
    for (const g of groups) {
      expect(g.name.startsWith(LABEL_PREFIX)).toBe(true);
      expect(g.children.length).toBeGreaterThanOrEqual(3);
    }
    const single = fixtures.projectLabelGroups.filter((g) => g.groupType === "singleSelect");
    expect(single.length).toBeGreaterThanOrEqual(2);
    expect(fixtures.projectLabelGroups.some((g) => g.groupType === "multiSelect")).toBe(true);
    expect(fixtures.initiativeLabelGroups.some((g) => g.groupType === "singleSelect")).toBe(true);
  });

  it("MIRROR-R27 labels projects and initiatives from the seed groups, one per single-select group", () => {
    for (const set of [
      { groups: fixtures.projectLabelGroups, items: fixtures.projects },
      { groups: fixtures.initiativeLabelGroups, items: fixtures.initiatives },
    ]) {
      const used = new Set<string>();
      for (const item of set.items) {
        for (const label of item.labels) {
          const group = set.groups.find((g) => g.name === label.group);
          expect(group?.children.map((c) => c.name)).toContain(label.name);
          used.add(`${label.group}/${label.name}`);
        }
        for (const g of set.groups.filter((g) => g.groupType === "singleSelect")) {
          expect(item.labels.filter((l) => l.group === g.name).length).toBeLessThanOrEqual(1);
        }
      }
      const all = set.groups.flatMap((g) => g.children.map((c) => `${g.name}/${c.name}`));
      expect(used).toEqual(new Set(all));
      expect(set.items.some((i) => i.labels.length === 0)).toBe(true);
    }
  });

  it("MIRROR-R27 links initiatives to projects, some projects to two and some to none", () => {
    const keys = new Set(fixtures.projects.map((p) => p.key));
    const count = new Map<string, number>();
    for (const i of fixtures.initiatives) {
      for (const k of i.projectKeys) {
        expect(keys.has(k)).toBe(true);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    expect(count.size).toBeLessThan(keys.size);
    expect([...count.values()].some((n) => n >= 2)).toBe(true);
    expect(fixtures.initiatives.filter((i) => i.projectKeys.length > 0).length).toBeGreaterThan(50);
  });

  it("MIRROR-R27 marks each description with its fixture key, within Linear's 255 characters", () => {
    for (const f of [...fixtures.projects, ...fixtures.initiatives]) {
      const description = descriptionFor(f.key);
      expect(description.length).toBeLessThanOrEqual(255);
      expect(description).toContain(`${MARKER}${f.key}`);
      expect(fixtureKeyOf(description)).toBe(f.key);
    }
    expect(fixtureKeyOf("A real project")).toBeNull();
    expect(fixtureKeyOf(null)).toBeNull();
    expect(fixtureKeyOf(`${MARKER}P0012`)).toBeNull();
  });
});
