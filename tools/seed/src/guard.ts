// Ownership rules and the check every write passes right before it is sent (MIRROR-R27).
// A project is the tool's to change only when it carries the fixture marker and every one of
// its teams is `Test` or a public team under it. An initiative carries the marker and is led
// by no team or by a team of the hierarchy. A label group is the tool's when its name starts
// with the label prefix; a label is the tool's when its group is. Nothing else is ever written,
// and private teams such as `SBX` are never part of the hierarchy (MIRROR-R28).
import { fixtureKeyOf, LABEL_PREFIX } from "./fixtures.ts";
import type { Initiative, Label, Project, Workspace } from "./model.ts";
import type { LabelKind, Write } from "./plan.ts";

export type GuardContext = {
  workspace: Workspace;
  /** Ids of `Test` and its public descendants. */
  hierarchy: ReadonlySet<string>;
  /** Creates already approved in this run, by the id they create; later writes may refer to them. */
  created: Map<string, Write>;
};

export function isSeedProject(p: Project, hierarchy: ReadonlySet<string>): boolean {
  return (
    !p.trashed &&
    fixtureKeyOf(p.description) !== null &&
    p.teamIds.length > 0 &&
    p.teamIds.every((id) => hierarchy.has(id))
  );
}

export function isSeedInitiative(i: Initiative, hierarchy: ReadonlySet<string>): boolean {
  return (
    !i.trashed &&
    fixtureKeyOf(i.description) !== null &&
    (i.leadTeamId === null || hierarchy.has(i.leadTeamId))
  );
}

export function isSeedGroup(l: Label, hierarchy: ReadonlySet<string>): boolean {
  return (
    l.isGroup && l.name.startsWith(LABEL_PREFIX) && (l.teamId === null || hierarchy.has(l.teamId))
  );
}

/** Ids of every label in `labels` the tool owns: seed groups and the labels inside them. */
export function seedLabelIds(labels: Label[], hierarchy: ReadonlySet<string>): Set<string> {
  const groups = new Set(labels.filter((l) => isSeedGroup(l, hierarchy)).map((l) => l.id));
  const owned = new Set(groups);
  for (const l of labels) if (l.parentId !== null && groups.has(l.parentId)) owned.add(l.id);
  return owned;
}

const labelsOf = (ctx: GuardContext, kind: LabelKind) =>
  kind === "projectLabel" ? ctx.workspace.projectLabels : ctx.workspace.initiativeLabels;

function createdOf(ctx: GuardContext, kind: Write["kind"], id: string): Write | undefined {
  const write = ctx.created.get(id);
  return write?.kind === kind ? write : undefined;
}

function isSeedGroupId(ctx: GuardContext, kind: LabelKind, id: string): boolean {
  const existing = labelsOf(ctx, kind).find((l) => l.id === id);
  if (existing) return isSeedGroup(existing, ctx.hierarchy);
  const created = createdOf(ctx, kind, id);
  return created?.op === "create" && "isGroup" in created.input && created.input.isGroup;
}

function isSeedLabelId(ctx: GuardContext, kind: LabelKind, id: string): boolean {
  if (seedLabelIds(labelsOf(ctx, kind), ctx.hierarchy).has(id)) return true;
  return createdOf(ctx, kind, id) !== undefined;
}

function isSeedProjectId(ctx: GuardContext, id: string): boolean {
  const existing = ctx.workspace.projects.find((p) => p.id === id);
  if (existing) return isSeedProject(existing, ctx.hierarchy);
  return createdOf(ctx, "project", id) !== undefined;
}

function isSeedInitiativeId(ctx: GuardContext, id: string): boolean {
  const existing = ctx.workspace.initiatives.find((i) => i.id === id);
  if (existing) return isSeedInitiative(existing, ctx.hierarchy);
  return createdOf(ctx, "initiative", id) !== undefined;
}

function teamsProblem(ctx: GuardContext, teamIds: string[] | undefined): string | null {
  if (teamIds === undefined) return null;
  if (teamIds.length === 0) return "a project needs at least one team of the Test hierarchy";
  const outside = teamIds.filter((id) => !ctx.hierarchy.has(id));
  return outside.length > 0 ? `teams ${outside.join(", ")} are outside the Test hierarchy` : null;
}

function leadTeamProblem(ctx: GuardContext, leadTeamId: string | null | undefined): string | null {
  if (leadTeamId === undefined || leadTeamId === null || ctx.hierarchy.has(leadTeamId)) return null;
  return `lead team ${leadTeamId} is outside the Test hierarchy`;
}

function markerProblem(description: string | undefined): string | null {
  if (description === undefined || fixtureKeyOf(description) !== null) return null;
  return "description lacks the fixture marker";
}

function labelsProblem(
  ctx: GuardContext,
  kind: LabelKind,
  labelIds: string[] | undefined,
  alreadyThere: string[] = [],
): string | null {
  const foreign = (labelIds ?? []).filter(
    (id) => !alreadyThere.includes(id) && !isSeedLabelId(ctx, kind, id),
  );
  return foreign.length > 0 ? `label ${foreign.join(", ")} is not a seed label` : null;
}

const first = (...problems: (string | null)[]) => problems.find((p) => p !== null) ?? null;

/** Why `write` must not be sent, or null when it may. */
export function refusal(write: Write, ctx: GuardContext): string | null {
  switch (write.kind) {
    case "projectLabel":
    case "initiativeLabel": {
      if (write.op === "create") {
        const { input } = write;
        if (input.isGroup) {
          if (!input.name.startsWith(LABEL_PREFIX)) {
            return `label group "${input.name}" lacks the "${LABEL_PREFIX}" prefix`;
          }
          return input.parentId === undefined ? null : "a label group cannot have a parent";
        }
        return input.parentId !== undefined && isSeedGroupId(ctx, write.kind, input.parentId)
          ? null
          : `label "${input.name}" is not inside a seed label group`;
      }
      const existing = labelsOf(ctx, write.kind).find((l) => l.id === write.id);
      if (!existing || !seedLabelIds(labelsOf(ctx, write.kind), ctx.hierarchy).has(existing.id)) {
        return `label ${write.id} is not a seed label`;
      }
      if (existing.isGroup && write.input.name !== undefined) {
        if (!write.input.name.startsWith(LABEL_PREFIX)) {
          return `label group "${write.input.name}" lacks the "${LABEL_PREFIX}" prefix`;
        }
      }
      if (
        write.input.parentId !== undefined &&
        !isSeedGroupId(ctx, write.kind, write.input.parentId)
      ) {
        return `label group ${write.input.parentId} is not a seed label group`;
      }
      return null;
    }
    case "project": {
      if (write.op === "create") {
        const { input } = write;
        return first(
          markerProblem(input.description),
          teamsProblem(ctx, input.teamIds),
          input.teamIds.includes(input.leadTeamId)
            ? null
            : `lead team ${input.leadTeamId} is not among the project's teams`,
          labelsProblem(ctx, "projectLabel", input.labelIds),
        );
      }
      const existing = ctx.workspace.projects.find((p) => p.id === write.id);
      if (!existing || !isSeedProject(existing, ctx.hierarchy)) {
        return `project ${write.id} is not a seed fixture inside the Test hierarchy`;
      }
      const { input } = write;
      const teams = input.teamIds ?? existing.teamIds;
      return first(
        markerProblem(input.description),
        teamsProblem(ctx, input.teamIds),
        leadTeamProblem(ctx, input.leadTeamId),
        input.leadTeamId === undefined || teams.includes(input.leadTeamId)
          ? null
          : `lead team ${input.leadTeamId} is not among the project's teams`,
        labelsProblem(ctx, "projectLabel", input.labelIds, existing.labelIds),
      );
    }
    case "initiative": {
      if (write.op === "create") {
        const { input } = write;
        return first(
          markerProblem(input.description),
          leadTeamProblem(ctx, input.leadTeamId),
          labelsProblem(ctx, "initiativeLabel", input.labelIds),
        );
      }
      const existing = ctx.workspace.initiatives.find((i) => i.id === write.id);
      if (!existing || !isSeedInitiative(existing, ctx.hierarchy)) {
        return `initiative ${write.id} is not a seed fixture of the Test hierarchy`;
      }
      return first(
        markerProblem(write.input.description),
        leadTeamProblem(ctx, write.input.leadTeamId),
        labelsProblem(ctx, "initiativeLabel", write.input.labelIds, existing.labelIds),
      );
    }
    case "link": {
      const { initiativeId, projectId } = write.input;
      if (!isSeedInitiativeId(ctx, initiativeId)) {
        return `initiative ${initiativeId} is not a seed fixture of the Test hierarchy`;
      }
      return isSeedProjectId(ctx, projectId)
        ? null
        : `project ${projectId} is not a seed fixture inside the Test hierarchy`;
    }
  }
}
