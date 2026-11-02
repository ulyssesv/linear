import { describe, expect, it } from "vitest";
import {
  appActorHourlyBudget,
  bootstrapPlan,
  type EntityType,
  estimateBootstrap,
  objectComplexity,
  pageComplexity,
} from "../src/server/linear/budget.ts";

// The fixture workspace of MIRROR-R27 with generous reference data.
const fixture: Record<EntityType, number> = {
  projects: 300,
  initiatives: 60,
  teams: 20,
  users: 50,
  projectStatuses: 10,
  initiativeStatuses: 10,
  projectLabels: 60,
  initiativeLabels: 60,
};

describe("bootstrap budget", () => {
  it("MIRROR-R4 scores objects and connections as Linear documents", () => {
    expect(objectComplexity({ fields: 3 })).toBeCloseTo(1.3);
    expect(objectComplexity({ fields: 1, objects: [{ fields: 2 }] })).toBeCloseTo(2.3);
    expect(
      objectComplexity({ fields: 0, connections: [{ first: 10, node: { fields: 1 } }] }),
    ).toBeCloseTo(12);
    // 50 nodes of 1.1 points plus pageInfo 1.2, rounded up.
    expect(pageComplexity(50, { fields: 1 })).toBe(57);
  });

  it("MIRROR-R4 keeps every bootstrap query under Linear's single-query cap", () => {
    for (const [type, { pageSize, node }] of Object.entries(bootstrapPlan)) {
      expect(pageComplexity(pageSize, node), type).toBeLessThanOrEqual(
        appActorHourlyBudget.maxQueryComplexity,
      );
    }
  });

  it("MIRROR-R4 a bootstrap of the fixture workspace fits well within one hour's budget", () => {
    const estimate = estimateBootstrap(fixture);
    // Matches the arithmetic in budget.ts; update both together.
    expect(estimate).toEqual({ requests: 14, complexity: 39_538, maxQueryComplexity: 5_742 });
    expect(estimate.requests).toBeLessThan(appActorHourlyBudget.requests * 0.01);
    expect(estimate.complexity).toBeLessThan(appActorHourlyBudget.complexity * 0.05);
  });

  it("MIRROR-R4 a workspace ten times the fixture still fits within a fifth of the budget", () => {
    const large = Object.fromEntries(
      Object.entries(fixture).map(([type, count]) => [type, count * 10]),
    ) as Record<EntityType, number>;
    const estimate = estimateBootstrap(large);
    expect(estimate.requests).toBeLessThan(appActorHourlyBudget.requests * 0.2);
    expect(estimate.complexity).toBeLessThan(appActorHourlyBudget.complexity * 0.2);
  });

  it("MIRROR-R4 an empty entity type still costs the request that finds it empty", () => {
    const empty = Object.fromEntries(Object.keys(fixture).map((t) => [t, 0])) as Record<
      EntityType,
      number
    >;
    expect(estimateBootstrap(empty).requests).toBe(Object.keys(bootstrapPlan).length);
  });
});
