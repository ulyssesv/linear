// How each mirror type maps onto its table (MIRROR-R9). Shared by apply.ts, the only
// writer, and read.ts; holds no queries of its own.
import type {
  Initiative,
  InitiativeLabel,
  InitiativeStatus,
  LatestUpdate,
  MirrorRecords,
  MirrorType,
  Project,
  ProjectLabel,
  ProjectStatus,
  Team,
  User,
} from "./types.ts";

/** A row to write: column name to value. */
export type Value = string | number | boolean | Date | null | readonly string[];
export type Row = Record<string, Value>;
/** A row as postgres.js reads it back. */
export type DbRow = Record<string, unknown>;

type TableSpec<T> = {
  table: string;
  /** Linear's columns, in insert order, without the bookkeeping ones. */
  columns: readonly string[];
  toRow(record: T): Row;
  fromRow(row: DbRow): T;
};

const tracked = ["id", "updated_at", "archived_at"] as const;

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function isoRequired(value: unknown): string {
  return iso(value) ?? "";
}

function trackedFrom(row: DbRow) {
  return {
    id: String(row.id),
    updatedAt: isoRequired(row.updated_at),
    archivedAt: iso(row.archived_at),
  };
}

function trackedTo(record: { id: string; updatedAt: string; archivedAt: string | null }): Row {
  return { id: record.id, updated_at: record.updatedAt, archived_at: record.archivedAt };
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

const latestUpdateColumns = [
  "last_update_id",
  "last_update_excerpt",
  "last_update_health",
  "last_update_at",
] as const;

function latestUpdateTo(update: LatestUpdate | null): Row {
  return {
    last_update_id: update?.id ?? null,
    last_update_excerpt: update?.excerpt ?? null,
    last_update_health: update?.health ?? null,
    last_update_at: update?.createdAt ?? null,
  };
}

function latestUpdateFrom(row: DbRow): LatestUpdate | null {
  if (row.last_update_id === null || row.last_update_id === undefined) return null;
  return {
    id: String(row.last_update_id),
    excerpt: String(row.last_update_excerpt ?? ""),
    health: nullableString(row.last_update_health),
    createdAt: isoRequired(row.last_update_at),
  };
}

const teams: TableSpec<Team> = {
  table: "mirror_teams",
  columns: [...tracked, "name", "key", "display_name", "parent_id", "private"],
  toRow: (t) => ({
    ...trackedTo(t),
    name: t.name,
    key: t.key,
    display_name: t.displayName,
    parent_id: t.parentId,
    private: t.private,
  }),
  fromRow: (r) => ({
    ...trackedFrom(r),
    name: String(r.name),
    key: String(r.key),
    displayName: String(r.display_name),
    parentId: nullableString(r.parent_id),
    private: Boolean(r.private),
  }),
};

const users: TableSpec<User> = {
  table: "mirror_users",
  columns: [...tracked, "name", "display_name", "email", "avatar_url", "active"],
  toRow: (u) => ({
    ...trackedTo(u),
    name: u.name,
    display_name: u.displayName,
    email: u.email,
    avatar_url: u.avatarUrl,
    active: u.active,
  }),
  fromRow: (r) => ({
    ...trackedFrom(r),
    name: String(r.name),
    displayName: String(r.display_name),
    email: String(r.email),
    avatarUrl: nullableString(r.avatar_url),
    active: Boolean(r.active),
  }),
};

const projectStatuses: TableSpec<ProjectStatus> = {
  table: "mirror_project_statuses",
  columns: [...tracked, "name", "type", "color", "position"],
  toRow: (s) => ({
    ...trackedTo(s),
    name: s.name,
    type: s.type,
    color: s.color,
    position: s.position,
  }),
  fromRow: (r) => ({
    ...trackedFrom(r),
    name: String(r.name),
    type: String(r.type),
    color: String(r.color),
    position: Number(r.position),
  }),
};

const initiativeStatuses: TableSpec<InitiativeStatus> = {
  table: "mirror_initiative_statuses",
  columns: [...tracked, "name", "position"],
  toRow: (s) => ({ ...trackedTo(s), name: s.name, position: s.position }),
  fromRow: (r) => ({ ...trackedFrom(r), name: String(r.name), position: Number(r.position) }),
};

const labelColumns = ["name", "color", "is_group", "selection", "parent_id"] as const;

function labelTo(l: InitiativeLabel): Row {
  return {
    ...trackedTo(l),
    name: l.name,
    color: l.color,
    is_group: l.isGroup,
    selection: l.selection,
    parent_id: l.parentId,
  };
}

function labelFrom(r: DbRow): InitiativeLabel {
  const selection = r.selection === "single" || r.selection === "multi" ? r.selection : null;
  return {
    ...trackedFrom(r),
    name: String(r.name),
    color: String(r.color),
    isGroup: Boolean(r.is_group),
    selection,
    parentId: nullableString(r.parent_id),
  };
}

const projectLabels: TableSpec<ProjectLabel> = {
  table: "mirror_project_labels",
  columns: [...tracked, ...labelColumns, "team_id"],
  toRow: (l) => ({ ...labelTo(l), team_id: l.teamId }),
  fromRow: (r) => ({ ...labelFrom(r), teamId: nullableString(r.team_id) }),
};

const initiativeLabels: TableSpec<InitiativeLabel> = {
  table: "mirror_initiative_labels",
  columns: [...tracked, ...labelColumns],
  toRow: labelTo,
  fromRow: labelFrom,
};

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function dateText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

const projects: TableSpec<Project> = {
  table: "mirror_projects",
  columns: [
    ...tracked,
    "name",
    "slug_id",
    "identifier",
    "url",
    "status_id",
    "lead_id",
    "start_date",
    "target_date",
    "priority",
    "health",
    "progress",
    "team_ids",
    "initiative_ids",
    "label_ids",
    ...latestUpdateColumns,
    "created_at",
    "completed_at",
    "canceled_at",
  ],
  toRow: (p) => ({
    ...trackedTo(p),
    name: p.name,
    slug_id: p.slugId,
    identifier: p.identifier,
    url: p.url,
    status_id: p.statusId,
    lead_id: p.leadId,
    start_date: p.startDate,
    target_date: p.targetDate,
    priority: p.priority,
    health: p.health,
    progress: p.progress,
    team_ids: p.teamIds,
    initiative_ids: p.initiativeIds,
    label_ids: p.labelIds,
    ...latestUpdateTo(p.lastUpdate),
    created_at: p.createdAt,
    completed_at: p.completedAt,
    canceled_at: p.canceledAt,
  }),
  fromRow: (r) => ({
    ...trackedFrom(r),
    name: String(r.name),
    slugId: String(r.slug_id),
    identifier: nullableString(r.identifier),
    url: String(r.url),
    statusId: nullableString(r.status_id),
    leadId: nullableString(r.lead_id),
    startDate: dateText(r.start_date),
    targetDate: dateText(r.target_date),
    priority: Number(r.priority),
    health: nullableString(r.health),
    progress: Number(r.progress),
    teamIds: ids(r.team_ids),
    initiativeIds: ids(r.initiative_ids),
    labelIds: ids(r.label_ids),
    lastUpdate: latestUpdateFrom(r),
    createdAt: isoRequired(r.created_at),
    completedAt: iso(r.completed_at),
    canceledAt: iso(r.canceled_at),
  }),
};

const initiatives: TableSpec<Initiative> = {
  table: "mirror_initiatives",
  columns: [
    ...tracked,
    "name",
    "slug_id",
    "identifier",
    "url",
    "status",
    "owner_id",
    "lead_team_id",
    "target_date",
    "priority",
    "health",
    "project_ids",
    "label_ids",
    ...latestUpdateColumns,
    "created_at",
    "completed_at",
  ],
  toRow: (i) => ({
    ...trackedTo(i),
    name: i.name,
    slug_id: i.slugId,
    identifier: i.identifier,
    url: i.url,
    status: i.status,
    owner_id: i.ownerId,
    lead_team_id: i.leadTeamId,
    target_date: i.targetDate,
    priority: i.priority,
    health: i.health,
    project_ids: i.projectIds,
    label_ids: i.labelIds,
    ...latestUpdateTo(i.lastUpdate),
    created_at: i.createdAt,
    completed_at: i.completedAt,
  }),
  fromRow: (r) => ({
    ...trackedFrom(r),
    name: String(r.name),
    slugId: String(r.slug_id),
    identifier: nullableString(r.identifier),
    url: String(r.url),
    status: String(r.status),
    ownerId: nullableString(r.owner_id),
    leadTeamId: nullableString(r.lead_team_id),
    targetDate: dateText(r.target_date),
    priority: Number(r.priority),
    health: nullableString(r.health),
    projectIds: ids(r.project_ids),
    labelIds: ids(r.label_ids),
    lastUpdate: latestUpdateFrom(r),
    createdAt: isoRequired(r.created_at),
    completedAt: iso(r.completed_at),
  }),
};

export const tables: { [T in MirrorType]: TableSpec<MirrorRecords[T]> } = {
  teams,
  users,
  projectStatuses,
  initiativeStatuses,
  projectLabels,
  initiativeLabels,
  projects,
  initiatives,
};

/** Every mirror table, for checks that must cover them all. */
export const mirrorTableNames: readonly string[] = Object.values(tables).map((t) => t.table);
