import { describe, expect, it } from "vitest";
import {
  appActorHourlyBudget,
  bootstrapPlan,
  type EntityType,
  estimateBootstrap,
  objectComplexity,
  pageComplexity,
  type Selection,
} from "../src/server/linear/budget.ts";
import { listingQueries } from "../src/server/mirror/listing.ts";

// The fixture workspace of MIRROR-R27 with generous reference data.
const fixture: Record<EntityType, number> = {
  projects: 300,
  initiatives: 60,
  teams: 20,
  users: 50,
  projectStatuses: 10,
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
    expect(estimate).toEqual({ requests: 13, complexity: 25_836, maxQueryComplexity: 3_067 });
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

// A small reader for the listing queries: enough GraphQL to turn a selection set into the
// Selection shape the budget prices. Arguments are skipped except a connection's `first`.
type Field = { name: string; first?: number; children?: Field[] };

function parseSelection(text: string): Field[] {
  const tokens = text.match(/\([^)]*\)|[{}]|[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  let at = 0;
  const set = (): Field[] => {
    const fields: Field[] = [];
    while (at < tokens.length && tokens[at] !== "}") {
      const field: Field = { name: tokens[at++] as string };
      if (tokens[at]?.startsWith("(")) {
        const first = /first:\s*(\d+)/.exec(tokens[at++] as string);
        if (first) field.first = Number(first[1]);
      }
      if (tokens[at] === "{") {
        at++;
        field.children = set();
        at++; // the closing brace
      }
      fields.push(field);
    }
    return fields;
  };
  return set();
}

function shape(fields: Field[]): Selection {
  const selection: Selection = { fields: 0, objects: [], connections: [] };
  for (const field of fields) {
    const nodes = field.children?.find((child) => child.name === "nodes");
    if (nodes?.children) {
      selection.connections?.push({ first: field.first ?? 50, node: shape(nodes.children) });
    } else if (field.children) {
      selection.objects?.push(shape(field.children));
    } else {
      selection.fields++;
    }
  }
  return selection;
}

/** Order-independent form of a shape, for comparison. */
function canonical(selection: Selection): unknown {
  const sorted = (items: unknown[]) => items.map((i) => JSON.stringify(i)).sort();
  return {
    fields: selection.fields,
    objects: sorted((selection.objects ?? []).map(canonical)),
    connections: sorted(
      (selection.connections ?? []).map((c) => ({ first: c.first, node: canonical(c.node) })),
    ),
  };
}

describe("bootstrap queries", () => {
  it("MIRROR-R4 every listing query selects exactly the shape the budget prices", () => {
    expect(Object.keys(listingQueries).sort()).toEqual(Object.keys(bootstrapPlan).sort());
    for (const [type, query] of Object.entries(listingQueries)) {
      const body = query.slice(query.indexOf("{") + 1, query.lastIndexOf("}"));
      const [root] = parseSelection(body);
      expect(root?.name, type).toBe(type);
      const nodes = root?.children?.find((child) => child.name === "nodes");
      const plan = bootstrapPlan[type as EntityType];
      expect(canonical(shape(nodes?.children ?? [])), type).toEqual(canonical(plan.node));
    }
  });
});
