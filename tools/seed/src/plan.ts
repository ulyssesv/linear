// The plan: the difference between the fixture set and the workspace (MIRROR-R27). Pure; the
// executor sends it, `--dry-run` only prints it. Existing fixtures are found by the marker in
// their description, so names may collide with anything without consequence. Missing fixtures
// are created, drifted fields updated, current ones left alone; nothing is ever deleted.
import { randomUUID } from "node:crypto";
import {
  descriptionFor,
  type FixtureSet,
  fixtureKeyOf,
  type LabelGroupFixture,
  type LabelRef,
  STATUS_SLOTS,
} from "./fixtures.ts";
import {
  type GuardContext,
  isSeedGroup,
  isSeedInitiative,
  isSeedProject,
  refusal,
  seedLabelIds,
} from "./guard.ts";
import {
  type InitiativeCreateInput,
  type InitiativeUpdateInput,
  type Label,
  type LabelCreateInput,
  type LabelUpdateInput,
  type LinkCreateInput,
  PROJECT_STATUS_TYPES,
  type ProjectCreateInput,
  type ProjectStatus,
  type ProjectUpdateInput,
  type Team,
  type Workspace,
} from "./model.ts";

export type LabelKind = "projectLabel" | "initiativeLabel";

export type Write =
  | { kind: LabelKind; op: "create"; input: LabelCreateInput }
  | { kind: LabelKind; op: "update"; id: string; input: LabelUpdateInput }
  | { kind: "project"; op: "create"; input: ProjectCreateInput }
  | { kind: "project"; op: "update"; id: string; input: ProjectUpdateInput }
  | { kind: "initiative"; op: "create"; input: InitiativeCreateInput }
  | { kind: "initiative"; op: "update"; id: string; input: InitiativeUpdateInput }
  | { kind: "link"; op: "create"; input: LinkCreateInput };

export type Kind = Write["kind"];
export const KINDS: Kind[] = ["projectLabel", "initiativeLabel", "project", "initiative", "link"];

/** Phases run in order: label groups, labels, projects and initiatives, links. */
type Meta = {
  key: string;
  title: string;
  phase: number;
  /** Changed fields for an update; empty for a create. */
  fields: string[];
  detail: string;
};
export type Step = Write & Meta;
export type Unchanged = {
  kind: Kind;
  op: "unchanged";
  id: string;
  key: string;
  title: string;
  phase: number;
};
export type PlanEntry = Step | Unchanged;
export type Plan = { entries: PlanEntry[]; warnings: string[]; errors: string[] };

export type PlanOptions = { teamName: string; newId?: () => string };

const LABEL_DESCRIPTION = "Planning sheet fixture label, seeded by tools/seed.";

/** `Test` and its public descendants: the root first, then the sub-teams ordered by key. */
export function hierarchyOf(
  teams: Team[],
  name: string,
): { teams: Team[]; warnings: string[]; errors: string[] } {
  const matches = teams.filter((t) => t.name === name || t.key === name);
  if (matches.length !== 1) {
    const why = matches.length === 0 ? "No team" : `${matches.length} teams`;
    return { teams: [], warnings: [], errors: [`${why} named or keyed "${name}"`] };
  }
  const root = matches[0] as Team;
  if (root.private) {
    return {
      teams: [],
      warnings: [],
      errors: [`Team ${root.key} is private; fixtures go only to public teams`],
    };
  }
  const warnings: string[] = [];
  const subs: Team[] = [];
  const queue = [root];
  for (let team = queue.shift(); team; team = queue.shift()) {
    for (const child of teams.filter((t) => t.parentId === team?.id)) {
      if (child.private) {
        warnings.push(`Skipping ${child.key}: private team, fixtures stay in public teams`);
        continue;
      }
      subs.push(child);
      queue.push(child);
    }
  }
  subs.sort((a, b) => a.key.localeCompare(b.key));
  if (subs.length === 0) warnings.push(`${root.key} has no public sub-team; all fixtures go to it`);
  return { teams: [root, ...subs], warnings, errors: [] };
}

type Counts = { create: number; update: number; unchanged: number };

export function summarize(entries: PlanEntry[]): Record<Kind, Counts> {
  const out = Object.fromEntries(
    KINDS.map((k) => [k, { create: 0, update: 0, unchanged: 0 }]),
  ) as Record<Kind, Counts>;
  for (const e of entries) out[e.kind][e.op]++;
  return out;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && new Set([...a, ...b]).size === new Set(a).size;

const unique = <T>(items: T[]) => [...new Set(items)];

const byCreatedAt = <T extends { createdAt: string; id: string }>(a: T, b: T) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

type FieldSpec<I> = { field: string; key: keyof I & string; set?: boolean };

/** The fields of `desired` that differ from `current`, and the update input carrying them. */
function diff<I extends object>(
  specs: FieldSpec<I>[],
  current: Record<string, unknown>,
  desired: I,
): { fields: string[]; input: Partial<I> } {
  const fields: string[] = [];
  const input: Partial<I> = {};
  for (const spec of specs) {
    const want = desired[spec.key];
    const have = current[spec.key] ?? null;
    const equal = spec.set
      ? sameSet(have as string[], want as string[])
      : (have ?? null) === ((want as unknown) ?? null);
    if (!equal) {
      fields.push(spec.field);
      input[spec.key] = want;
    }
  }
  return { fields, input };
}

const PROJECT_FIELDS: FieldSpec<ProjectUpdateInput>[] = [
  { field: "name", key: "name" },
  { field: "description", key: "description" },
  { field: "status", key: "statusId" },
  { field: "lead", key: "leadId" },
  { field: "leadTeam", key: "leadTeamId" },
  { field: "teams", key: "teamIds", set: true },
  { field: "startDate", key: "startDate" },
  { field: "targetDate", key: "targetDate" },
  { field: "priority", key: "priority" },
  { field: "labels", key: "labelIds", set: true },
];

const INITIATIVE_FIELDS: FieldSpec<InitiativeUpdateInput>[] = [
  { field: "name", key: "name" },
  { field: "description", key: "description" },
  { field: "status", key: "status" },
  { field: "owner", key: "ownerId" },
  { field: "leadTeam", key: "leadTeamId" },
  { field: "targetDate", key: "targetDate" },
  { field: "priority", key: "priority" },
  { field: "labels", key: "labelIds", set: true },
];

const LABEL_FIELDS: FieldSpec<LabelUpdateInput>[] = [
  { field: "groupType", key: "groupType" },
  { field: "color", key: "color" },
  { field: "description", key: "description" },
];

export function planSeed(fixtures: FixtureSet, ws: Workspace, options: PlanOptions): Plan {
  const newId = options.newId ?? randomUUID;
  const h = hierarchyOf(ws.teams, options.teamName);
  const warnings = [...h.warnings];
  const errors = [...h.errors];
  if (errors.length > 0) return { entries: [], warnings, errors };

  const [root, ...subs] = h.teams as [Team, ...Team[]];
  const hierarchy = new Set(h.teams.map((t) => t.id));
  const teamFor = (slot: number) =>
    slot === 0 || subs.length === 0 ? root : (subs[(slot - 1) % subs.length] as Team);

  const members = ws.users
    .filter((u) => u.active && !u.guest && !u.app)
    .sort((a, b) => a.email.localeCompare(b.email));
  if (members.length === 0) {
    warnings.push("No active member to lead projects or own initiatives; they stay unassigned");
  } else if (members.length < 3) {
    warnings.push(`Only ${members.length} active member(s); fixtures share fewer leads`);
  }
  const memberFor = (slot: number | null) =>
    slot === null || members.length === 0 ? null : (members[slot % members.length]?.id ?? null);

  // Every workspace project status, in type order then position; fixtures pick by slot, so
  // they span whichever statuses exist (a workspace need not have every type, e.g. paused).
  const typeOrder = (type: string) => {
    const i = (PROJECT_STATUS_TYPES as readonly string[]).indexOf(type);
    return i === -1 ? PROJECT_STATUS_TYPES.length : i;
  };
  const statuses = ws.projectStatuses
    .filter((s) => s.teamId === null)
    .sort((a, b) => typeOrder(a.type) - typeOrder(b.type) || a.position - b.position);
  if (statuses.length === 0) errors.push("No workspace project status");
  else if (statuses.length > STATUS_SLOTS) {
    warnings.push(
      `${statuses.length} project statuses but ${STATUS_SLOTS} status slots; ` +
        `${statuses.length - STATUS_SLOTS} statuses get no fixture`,
    );
  }
  const statusFor = (slot: number) => statuses[slot % statuses.length] as ProjectStatus;
  if (errors.length > 0) return { entries: [], warnings, errors };

  // Display names for the printed plan.
  const names = new Map<string, string>();
  for (const t of ws.teams) names.set(t.id, t.key);
  for (const u of ws.users) names.set(u.id, u.name);
  for (const s of ws.projectStatuses) names.set(s.id, s.name);
  for (const l of [...ws.projectLabels, ...ws.initiativeLabels]) names.set(l.id, l.name);
  const show = (value: unknown): string => {
    if (value === null || value === undefined) return "none";
    if (Array.isArray(value)) return value.length === 0 ? "none" : value.map(show).join("+");
    if (typeof value === "string") return names.get(value) ?? JSON.stringify(value);
    return String(value);
  };
  const changes = (fields: string[], specs: FieldSpec<object>[], from: object, to: object) =>
    fields
      .map((field) => {
        const key = specs.find((s) => s.field === field)?.key ?? field;
        if (field === "description") return "description";
        return `${field} ${show((from as Record<string, unknown>)[key])} -> ${show((to as Record<string, unknown>)[key])}`;
      })
      .join("; ");

  const entries: PlanEntry[] = [];
  const ctx: GuardContext = { workspace: ws, hierarchy, created: new Map() };
  const add = (step: Step) => {
    const why = refusal(step, ctx);
    if (why !== null) {
      errors.push(`Planned ${step.op} of ${step.kind} ${step.key} refused: ${why}`);
      return;
    }
    if (step.op === "create" && step.kind !== "link") ctx.created.set(step.input.id, step);
    entries.push(step);
  };

  const planLabels = (kind: LabelKind, groups: LabelGroupFixture[], labels: Label[]) => {
    const ids = new Map<string, string>();
    for (const group of groups) {
      if (labels.some((l) => !l.isGroup && l.name === group.name)) {
        warnings.push(`A plain ${kind} is named "${group.name}"; Linear may refuse the group`);
      }
      const matches = labels.filter((l) => l.name === group.name && isSeedGroup(l, hierarchy));
      if (matches.length > 1) {
        warnings.push(
          `Duplicate ${kind} group "${group.name}": using ${matches[0]?.id}, ignoring ` +
            matches
              .slice(1)
              .map((l) => l.id)
              .join(", "),
        );
      }
      const groupId = planLabel(kind, matches[0], 0, group.name, {
        name: group.name,
        description: LABEL_DESCRIPTION,
        color: group.color,
        isGroup: true,
        groupType: group.groupType,
      });
      for (const child of group.children) {
        const existing = labels.find(
          (l) => l.parentId === groupId && l.name === child.name && !l.isGroup,
        );
        const id = planLabel(kind, existing, 1, `${group.name}/${child.name}`, {
          name: child.name,
          description: LABEL_DESCRIPTION,
          color: child.color,
          isGroup: false,
          parentId: groupId,
        });
        ids.set(`${group.name}/${child.name}`, id);
      }
    }
    return ids;
  };

  const planLabel = (
    kind: LabelKind,
    existing: Label | undefined,
    phase: number,
    key: string,
    desired: Omit<LabelCreateInput, "id">,
  ): string => {
    const title = `${kind === "projectLabel" ? "project" : "initiative"} label ${key}`;
    if (!existing) {
      const id = newId();
      names.set(id, desired.name);
      const detail = desired.isGroup
        ? `group, ${desired.groupType}`
        : `in ${show(desired.parentId)}`;
      add({ kind, op: "create", input: { id, ...desired }, key, title, phase, fields: [], detail });
      return id;
    }
    if (existing.retiredAt !== null) warnings.push(`${title} (${existing.id}) is retired`);
    const current = { ...existing, description: existing.description ?? "" };
    const { fields, input } = diff(LABEL_FIELDS, current, desired);
    if (fields.length === 0) {
      entries.push({ kind, op: "unchanged", id: existing.id, key, title, phase });
    } else {
      const detail = changes(fields, LABEL_FIELDS, current, desired);
      add({ kind, op: "update", id: existing.id, input, key, title, phase, fields, detail });
    }
    return existing.id;
  };

  const projectLabelIds = planLabels("projectLabel", fixtures.projectLabelGroups, ws.projectLabels);
  const initiativeLabelIds = planLabels(
    "initiativeLabel",
    fixtures.initiativeLabelGroups,
    ws.initiativeLabels,
  );
  const ownedProjectLabels = seedLabelIds(ws.projectLabels, hierarchy);
  const ownedInitiativeLabels = seedLabelIds(ws.initiativeLabels, hierarchy);
  const labelIdsOf = (map: Map<string, string>, refs: LabelRef[]) =>
    refs.map((r) => map.get(`${r.group}/${r.name}`)).filter((id): id is string => !!id);

  /** Marked entities the tool may change, by fixture key; warns about the ones it must not. */
  const index = <
    T extends { id: string; description: string | null; createdAt: string; trashed: boolean },
  >(
    kind: string,
    items: T[],
    owned: (item: T) => boolean,
  ): Map<string, T> => {
    const out = new Map<string, T>();
    for (const item of [...items].sort(byCreatedAt)) {
      const key = fixtureKeyOf(item.description);
      if (key === null) continue;
      const kept = out.get(key);
      if (item.trashed) warnings.push(`Ignoring trashed ${kind} ${key} (${item.id})`);
      else if (!owned(item)) {
        warnings.push(
          `Ignoring ${kind} ${key} (${item.id}): marked as a fixture but outside the ${root.key} hierarchy`,
        );
      } else if (kept) {
        warnings.push(`Duplicate ${kind} fixture ${key}: keeping ${kept.id}, ignoring ${item.id}`);
      } else out.set(key, item);
    }
    return out;
  };

  const projectIds = new Map<string, string>();
  const seedProjects = index("project", ws.projects, (p) => isSeedProject(p, hierarchy));
  for (const f of fixtures.projects) {
    const teamIds = unique(f.teamSlots.map((slot) => teamFor(slot).id));
    const desired: Omit<ProjectCreateInput, "id"> = {
      name: f.name,
      description: descriptionFor(f.key),
      teamIds,
      leadTeamId: teamIds[0] as string,
      statusId: statusFor(f.statusSlot).id,
      leadId: memberFor(f.leadSlot),
      startDate: f.startDate,
      targetDate: f.targetDate,
      priority: f.priority,
      labelIds: labelIdsOf(projectLabelIds, f.labels),
    };
    const title = `project ${f.key} "${f.name}"`;
    const existing = seedProjects.get(f.key);
    if (!existing) {
      const id = newId();
      projectIds.set(f.key, id);
      const detail =
        `${show(teamIds)}, ${show(desired.statusId)}, lead ${show(desired.leadId)}, ` +
        `${desired.startDate ?? "no start"} to ${desired.targetDate ?? "no target"}, ` +
        `priority ${desired.priority}, labels ${show(desired.labelIds)}`;
      add({
        kind: "project",
        op: "create",
        input: { id, ...desired },
        key: f.key,
        title,
        phase: 2,
        fields: [],
        detail,
      });
      continue;
    }
    projectIds.set(f.key, existing.id);
    const foreign = existing.labelIds.filter((id) => !ownedProjectLabels.has(id));
    const want = { ...desired, labelIds: [...desired.labelIds, ...foreign] };
    const { fields, input } = diff(PROJECT_FIELDS, existing, want);
    if (fields.length === 0) {
      entries.push({
        kind: "project",
        op: "unchanged",
        id: existing.id,
        key: f.key,
        title,
        phase: 2,
      });
    } else {
      const detail = changes(fields, PROJECT_FIELDS, existing, want);
      add({
        kind: "project",
        op: "update",
        id: existing.id,
        input,
        key: f.key,
        title,
        phase: 2,
        fields,
        detail,
      });
    }
  }

  const initiativeIds = new Map<string, string>();
  const seedInitiatives = index("initiative", ws.initiatives, (i) =>
    isSeedInitiative(i, hierarchy),
  );
  for (const f of fixtures.initiatives) {
    const desired: Omit<InitiativeCreateInput, "id"> = {
      name: f.name,
      description: descriptionFor(f.key),
      status: f.status,
      ownerId: memberFor(f.ownerSlot),
      leadTeamId: f.leadTeamSlot === null ? null : teamFor(f.leadTeamSlot).id,
      targetDate: f.targetDate,
      priority: f.priority,
      labelIds: labelIdsOf(initiativeLabelIds, f.labels),
    };
    const title = `initiative ${f.key} "${f.name}"`;
    const existing = seedInitiatives.get(f.key);
    if (!existing) {
      const id = newId();
      initiativeIds.set(f.key, id);
      const detail =
        `${desired.status}, owner ${show(desired.ownerId)}, lead team ${show(desired.leadTeamId)}, ` +
        `target ${desired.targetDate ?? "none"}, priority ${desired.priority}, ` +
        `labels ${show(desired.labelIds)}, linked to ${f.projectKeys.length}`;
      add({
        kind: "initiative",
        op: "create",
        input: { id, ...desired },
        key: f.key,
        title,
        phase: 2,
        fields: [],
        detail,
      });
      continue;
    }
    initiativeIds.set(f.key, existing.id);
    const foreign = existing.labelIds.filter((id) => !ownedInitiativeLabels.has(id));
    const want = { ...desired, labelIds: [...desired.labelIds, ...foreign] };
    const { fields, input } = diff(INITIATIVE_FIELDS, existing, want);
    if (fields.length === 0) {
      entries.push({
        kind: "initiative",
        op: "unchanged",
        id: existing.id,
        key: f.key,
        title,
        phase: 2,
      });
    } else {
      const detail = changes(fields, INITIATIVE_FIELDS, existing, want);
      add({
        kind: "initiative",
        op: "update",
        id: existing.id,
        input,
        key: f.key,
        title,
        phase: 2,
        fields,
        detail,
      });
    }
  }

  const linked = new Set(ws.links.map((l) => `${l.initiativeId}>${l.projectId}`));
  for (const f of fixtures.initiatives) {
    for (const projectKey of f.projectKeys) {
      const initiativeId = initiativeIds.get(f.key) as string;
      const projectId = projectIds.get(projectKey) as string;
      const key = `${f.key}>${projectKey}`;
      const title = `link ${f.key} to ${projectKey}`;
      const id = `${initiativeId}>${projectId}`;
      if (linked.has(id)) {
        entries.push({ kind: "link", op: "unchanged", id, key, title, phase: 3 });
      } else {
        const input = { initiativeId, projectId };
        add({ kind: "link", op: "create", input, key, title, phase: 3, fields: [], detail: "" });
      }
    }
  }

  // Stable: within a phase, entries keep fixture order.
  entries.sort((a, b) => a.phase - b.phase);
  return { entries, warnings, errors };
}

/** One line per entry, for the printed plan and the progress log. */
export function formatEntry(entry: PlanEntry, verb?: string): string {
  const action = verb ?? entry.op;
  if (entry.op === "unchanged") return `${action} ${entry.title}`;
  const detail = entry.detail ? `: ${entry.detail}` : "";
  return `${action} ${entry.title}${detail}`;
}
