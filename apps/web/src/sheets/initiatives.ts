// The initiatives sheet (MIRROR-R18, MIRROR-R19): one row per mirrored initiative, archived
// and removed ones included and flagged, with the columns of spec MIRROR section 4.
import type {
  Initiative,
  InitiativeLabel,
  Mirrored,
  Project,
  Team,
  User,
} from "@/server/mirror/types";
import { labelGroupColumns } from "./labels.ts";
import {
  healthBadge,
  priorityBadge,
  type SheetColumn,
  type SheetModel,
  type SheetRow,
  safeLink,
} from "./model.ts";
import { byId, chips, flagsOf, latestUpdate } from "./shared.ts";

export type InitiativesSheetSource = {
  initiatives: readonly Mirrored<Initiative>[];
  users: readonly Mirrored<User>[];
  teams: readonly Mirrored<Team>[];
  initiativeLabels: readonly Mirrored<InitiativeLabel>[];
  projects: readonly Mirrored<Project>[];
};

export function buildInitiativesSheet(source: InitiativesSheetSource): SheetModel {
  const users = byId(source.users);
  const teams = byId(source.teams);
  const liveProjects = new Set(source.projects.filter((p) => !p.removedAt).map((p) => p.id));
  const groups = labelGroupColumns(source.initiativeLabels, (id) => teams.get(id)?.name);

  const columns: SheetColumn[] = [
    { id: "name", title: "Name", shape: "text" },
    { id: "status", title: "Status", shape: "badge" },
    { id: "owner", title: "Owner", shape: "user" },
    { id: "targetDate", title: "Target date", shape: "date" },
    { id: "priority", title: "Priority", shape: "badge" },
    ...groups.columns,
    { id: "leadTeam", title: "Lead team", shape: "chips" },
    { id: "health", title: "Health", shape: "badge" },
    { id: "projects", title: "Projects", shape: "number" },
    { id: "latestUpdate", title: "Latest update", shape: "excerpt" },
    { id: "link", title: "Link", shape: "link" },
  ];

  const rows = source.initiatives.map((initiative): SheetRow => {
    const owner = initiative.ownerId ? users.get(initiative.ownerId) : undefined;
    return {
      id: initiative.id,
      flags: flagsOf(initiative),
      cells: {
        name: initiative.name,
        // Initiative statuses are a fixed set in Linear: Planned, Active, Completed.
        status: initiative.status ? { label: initiative.status, color: null } : null,
        owner: owner ? { name: owner.name } : null,
        targetDate: initiative.targetDate,
        priority: priorityBadge(initiative.priority),
        ...groups.cells(initiative.labelIds),
        leadTeam: chips(initiative.leadTeamId ? [initiative.leadTeamId] : [], teams),
        health: healthBadge(initiative.health),
        projects: initiative.projectIds.filter((id) => liveProjects.has(id)).length,
        latestUpdate: latestUpdate(initiative.lastUpdate),
        link: safeLink(initiative.url, initiative.identifier ?? initiative.slugId),
      },
    };
  });

  return { kind: "initiatives", columns, rows };
}
