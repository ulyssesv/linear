// The fixture set for the planning sheet (MIRROR-R27), generated from a fixed seed so every run
// asks for the same entities. Pure: no workspace ids here, only slots that the planner resolves
// against the workspace (team slot 0 is the `Test` team, 1.. its sub-teams by key; user slots
// index the workspace's members by email).
import {
  type GroupType,
  INITIATIVE_STATUSES,
  type InitiativeStatus,
  PROJECT_STATUS_TYPES,
  type ProjectStatusType,
} from "./model.ts";

/** Identity marker carried in every fixture description, followed by the fixture key. */
export const MARKER = "seed-fixture:";
/** Name prefix of every label group the tool owns. Labels inside those groups are owned too. */
export const LABEL_PREFIX = "Fixture ";
export const DEFAULT_SEED = 2026;

export type LabelRef = { group: string; name: string };
export type LabelGroupFixture = {
  name: string;
  groupType: GroupType;
  color: string;
  children: { name: string; color: string }[];
};

export type ProjectFixture = {
  key: string;
  name: string;
  teamSlots: number[];
  statusType: ProjectStatusType;
  leadSlot: number | null;
  startDate: string | null;
  targetDate: string | null;
  priority: number;
  labels: LabelRef[];
};

export type InitiativeFixture = {
  key: string;
  name: string;
  status: InitiativeStatus;
  ownerSlot: number | null;
  leadTeamSlot: number | null;
  targetDate: string | null;
  priority: number;
  labels: LabelRef[];
  projectKeys: string[];
};

export type FixtureSet = {
  projectLabelGroups: LabelGroupFixture[];
  initiativeLabelGroups: LabelGroupFixture[];
  projects: ProjectFixture[];
  initiatives: InitiativeFixture[];
};

const PROJECT_LABEL_GROUPS: LabelGroupFixture[] = [
  {
    name: `${LABEL_PREFIX}Theme`,
    groupType: "singleSelect",
    color: "#5e6ad2",
    children: [
      { name: "Growth", color: "#26b5ce" },
      { name: "Reliability", color: "#f2994a" },
      { name: "Platform", color: "#4cb782" },
      { name: "Compliance", color: "#eb5757" },
      { name: "Experience", color: "#bb87fc" },
    ],
  },
  {
    name: `${LABEL_PREFIX}Size`,
    groupType: "singleSelect",
    color: "#95a2b3",
    children: [
      { name: "Small", color: "#4cb782" },
      { name: "Medium", color: "#f2c94c" },
      { name: "Large", color: "#f2994a" },
      { name: "Extra large", color: "#eb5757" },
    ],
  },
  {
    name: `${LABEL_PREFIX}Tags`,
    groupType: "multiSelect",
    color: "#6b6f76",
    children: [
      { name: "Customer ask", color: "#26b5ce" },
      { name: "Tech debt", color: "#95a2b3" },
      { name: "Security review", color: "#eb5757" },
    ],
  },
];

const INITIATIVE_LABEL_GROUPS: LabelGroupFixture[] = [
  {
    name: `${LABEL_PREFIX}Track`,
    groupType: "singleSelect",
    color: "#5e6ad2",
    children: [
      { name: "Bet", color: "#bb87fc" },
      { name: "Commitment", color: "#4cb782" },
      { name: "Exploration", color: "#26b5ce" },
      { name: "Maintenance", color: "#95a2b3" },
    ],
  },
];

const AREAS = [
  "Checkout",
  "Search",
  "Onboarding",
  "Billing",
  "Notifications",
  "Mobile app",
  "Admin console",
  "Reporting",
  "Integrations",
  "Permissions",
  "Data pipeline",
  "Design system",
  "Help center",
  "Pricing page",
  "Public API",
  "Identity",
];
const WORK = [
  "redesign",
  "migration",
  "performance pass",
  "accessibility audit",
  "v2 rollout",
  "cleanup",
  "beta",
  "instrumentation",
  "localization",
  "reliability push",
  "self-serve flow",
  "pricing experiment",
  "sunset",
  "consolidation",
  "offline mode",
  "audit log",
  "revamp",
  "hardening",
  "A/B test",
  "launch",
];
const THEMES = [
  "Grow self-serve revenue",
  "Win enterprise accounts",
  "Cut infrastructure cost",
  "Raise activation",
  "Expand to new regions",
  "Modernize the platform",
  "Improve trust and safety",
  "Delight power users",
];
const PERIODS = [
  "Q1 2026",
  "Q2 2026",
  "Q3 2026",
  "Q4 2026",
  "Q1 2027",
  "Q2 2027",
  "Q3 2027",
  "Q4 2027",
];

/** Multi-team placements by team slot: sub-team pairs, parent plus a sub-team, all sub-teams. */
const MULTI_TEAM = [
  [1, 2],
  [2, 3],
  [1, 3],
  [0, 1],
  [0, 3],
  [1, 2, 3],
];
const LEAD_SLOTS = 6;
const TEAM_SLOTS = 4;
const BASE_DATE = Date.UTC(2026, 0, 5);
const WEEK = 7 * 24 * 60 * 60 * 1000;

/** The description of a project or initiative fixture; its last line is the identity marker. */
export function descriptionFor(key: string): string {
  return (
    `Planning sheet fixture ${key}, seeded by tools/seed (pnpm seed:fixtures). ` +
    `Edits to seeded fields are overwritten on the next run.\n${MARKER}${key}`
  );
}

/** The fixture key a description carries, or null when it is not a seed fixture. */
export function fixtureKeyOf(description: string | null | undefined): string | null {
  const match = /(?:^|\s)seed-fixture:(P\d{3}|I\d{2})(?=\s|$)/.exec(description ?? "");
  return match?.[1] ?? null;
}

/** Mulberry32: small, fast and good enough to spread fixtures deterministically. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function pick<T>(items: readonly T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)] as T;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The last day of a period such as "Q3 2026". */
function quarterEnd(period: string): string {
  const [q, year] = period.slice(1).split(" ").map(Number) as [number, number];
  return day(Date.UTC(year, q * 3, 0));
}

function children(groups: LabelGroupFixture[], name: string): string[] {
  return groups.find((g) => g.name === name)?.children.map((c) => c.name) ?? [];
}

/** A fifth of the projects in the parent team, three fifths in one sub-team, the rest in
 * several teams. The first five cover each team and the all-sub-teams case outright. */
function teamSlotsFor(i: number, rand: () => number): number[] {
  if (i < TEAM_SLOTS) return [i];
  if (i === TEAM_SLOTS) return [1, 2, 3];
  const r = rand();
  if (r < 0.2) return [0];
  if (r < 0.8) return [1 + Math.floor(rand() * 3)];
  return pick(MULTI_TEAM, rand);
}

export function generateFixtures(seed = DEFAULT_SEED): FixtureSet {
  const rand = random(seed);
  const themes = children(PROJECT_LABEL_GROUPS, `${LABEL_PREFIX}Theme`);
  const sizes = children(PROJECT_LABEL_GROUPS, `${LABEL_PREFIX}Size`);
  const tags = children(PROJECT_LABEL_GROUPS, `${LABEL_PREFIX}Tags`);
  const tracks = children(INITIATIVE_LABEL_GROUPS, `${LABEL_PREFIX}Track`);

  const projectNames = shuffled(
    AREAS.flatMap((area) => WORK.map((work) => `${area} ${work}`)),
    rand,
  );
  const projects: ProjectFixture[] = projectNames.map((name, i) => {
    // The first few fixtures pin coverage so a different seed cannot lose a status or team.
    const teamSlots = teamSlotsFor(i, rand);
    const statusType =
      i < PROJECT_STATUS_TYPES.length
        ? (PROJECT_STATUS_TYPES[i] as ProjectStatusType)
        : pick(PROJECT_STATUS_TYPES, rand);
    const leadSlot = rand() < 0.1 ? null : Math.floor(rand() * LEAD_SLOTS);
    const start = rand() < 0.15 ? null : BASE_DATE + Math.floor(rand() * 80) * WEEK;
    const target =
      rand() < 0.15
        ? null
        : (start ?? BASE_DATE + Math.floor(rand() * 60) * WEEK) +
          (2 + Math.floor(rand() * 24)) * WEEK;
    const priority = Math.floor(rand() * 5);
    const labels: LabelRef[] = [];
    if (rand() < 0.85) labels.push({ group: `${LABEL_PREFIX}Theme`, name: pick(themes, rand) });
    if (rand() < 0.75) labels.push({ group: `${LABEL_PREFIX}Size`, name: pick(sizes, rand) });
    for (const tag of shuffled(tags, rand).slice(0, Math.floor(rand() * 3))) {
      labels.push({ group: `${LABEL_PREFIX}Tags`, name: tag });
    }
    return {
      key: `P${String(i + 1).padStart(3, "0")}`,
      name,
      teamSlots,
      statusType,
      leadSlot,
      startDate: start === null ? null : day(start),
      targetDate: target === null ? null : day(target),
      priority,
      labels,
    };
  });

  const initiativeNames = shuffled(
    THEMES.flatMap((theme) => PERIODS.map((period) => ({ theme, period }))),
    rand,
  );
  const initiatives: InitiativeFixture[] = initiativeNames.map(({ theme, period }, i) => ({
    key: `I${String(i + 1).padStart(2, "0")}`,
    name: `${theme}, ${period}`,
    status:
      i < INITIATIVE_STATUSES.length
        ? (INITIATIVE_STATUSES[i] as InitiativeStatus)
        : pick(INITIATIVE_STATUSES, rand),
    ownerSlot: rand() < 0.1 ? null : Math.floor(rand() * LEAD_SLOTS),
    leadTeamSlot: rand() < 0.25 ? null : Math.floor(rand() * TEAM_SLOTS),
    targetDate: rand() < 0.2 ? null : quarterEnd(period),
    priority: Math.floor(rand() * 5),
    labels: rand() < 0.8 ? [{ group: `${LABEL_PREFIX}Track`, name: pick(tracks, rand) }] : [],
    projectKeys: [],
  }));

  for (const project of projects) {
    if (rand() >= 0.85) continue;
    const first = Math.floor(rand() * initiatives.length);
    initiatives[first]?.projectKeys.push(project.key);
    if (rand() < 0.12) {
      const second =
        (first + 1 + Math.floor(rand() * (initiatives.length - 1))) % initiatives.length;
      initiatives[second]?.projectKeys.push(project.key);
    }
  }

  return {
    projectLabelGroups: PROJECT_LABEL_GROUPS,
    initiativeLabelGroups: INITIATIVE_LABEL_GROUPS,
    projects,
    initiatives,
  };
}
