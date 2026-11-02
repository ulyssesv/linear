// The projects sheet (MIRROR-R18, MIRROR-R19): one row per mirrored project, archived and
// removed ones included and flagged, with the columns of spec MIRROR section 4.
import type {
  Initiative,
  Mirrored,
  Project,
  ProjectLabel,
  ProjectStatus,
  Team,
  User,
} from "@/server/mirror/types";
import { labelGroupColumns } from "./labels.ts";
import {
  type Chip,
  healthBadge,
  priorityBadge,
  type SheetColumn,
  type SheetModel,
  type SheetRow,
  safeLink,
} from "./model.ts";
import { byId, chips, flagsOf, latestUpdate } from "./shared.ts";

export type ProjectsSheetSource = {
  projects: readonly Mirrored<Project>[];
  projectStatuses: readonly Mirrored<ProjectStatus>[];
  users: readonly Mirrored<User>[];
  teams: readonly Mirrored<Team>[];
  projectLabels: readonly Mirrored<ProjectLabel>[];
  initiatives: readonly Mirrored<Initiative>[];
};

export function buildProjectsSheet(source: ProjectsSheetSource): SheetModel {
  const statuses = byId(source.projectStatuses);
  const users = byId(source.users);
  const teams = byId(source.teams);
  const initiatives = byId(source.initiatives);
  const groups = labelGroupColumns(source.projectLabels, (id) => teams.get(id)?.name);

  const columns: SheetColumn[] = [
    { id: "name", title: "Name", shape: "text" },
    { id: "status", title: "Status", shape: "badge" },
    { id: "lead", title: "Lead", shape: "user" },
    { id: "startDate", title: "Start date", shape: "date" },
    { id: "targetDate", title: "Target date", shape: "date" },
    { id: "priority", title: "Priority", shape: "badge" },
    ...groups.columns,
    { id: "teams", title: "Teams", shape: "chips" },
    { id: "initiatives", title: "Initiatives", shape: "chips" },
    { id: "health", title: "Health", shape: "badge" },
    { id: "progress", title: "Progress", shape: "percent" },
    { id: "latestUpdate", title: "Latest update", shape: "excerpt" },
    { id: "link", title: "Link", shape: "link" },
  ];

  const rows = source.projects.map((project): SheetRow => {
    const status = project.statusId ? statuses.get(project.statusId) : undefined;
    const lead = project.leadId ? users.get(project.leadId) : undefined;
    return {
      id: project.id,
      flags: flagsOf(project),
      cells: {
        name: project.name,
        status: status ? ({ label: status.name, color: status.color || null } as Chip) : null,
        lead: lead ? { name: lead.name } : null,
        startDate: project.startDate,
        targetDate: project.targetDate,
        priority: priorityBadge(project.priority),
        ...groups.cells(project.labelIds),
        teams: chips(project.teamIds, teams),
        initiatives: chips(project.initiativeIds, initiatives),
        health: healthBadge(project.health),
        progress: project.progress,
        latestUpdate: latestUpdate(project.lastUpdate),
        link: safeLink(project.url, project.identifier ?? project.slugId),
      },
    };
  });

  return { kind: "projects", columns, rows };
}
