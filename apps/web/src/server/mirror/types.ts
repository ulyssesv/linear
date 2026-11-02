// Normalised mirror records (MIRROR-R9): what the feeders hand to apply.ts and what
// read.ts returns, independent of whether a value came from a GraphQL listing (bootstrap,
// reconcile) or a webhook payload. Timestamps are ISO 8601 strings; dates without a time
// are `YYYY-MM-DD`.

export type SyncSource = "bootstrap" | "webhook" | "reconcile";

export const syncSources: readonly SyncSource[] = ["bootstrap", "webhook", "reconcile"];

/** Fields every mirrored entity carries. */
export type Tracked = {
  id: string;
  /** When Linear last changed the entity. */
  updatedAt: string;
  /** When Linear archived it; null when it is not archived. */
  archivedAt: string | null;
};

export type Team = Tracked & {
  name: string;
  key: string;
  displayName: string;
  parentId: string | null;
  private: boolean;
};

export type User = Tracked & {
  name: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  active: boolean;
};

export type ProjectStatus = Tracked & {
  name: string;
  /** backlog, planned, started, paused, completed or canceled */
  type: string;
  color: string;
  position: number;
};

export type InitiativeStatus = Tracked & {
  name: string;
  position: number;
};

/** A label or, when `isGroup`, a label group. */
export type Label = Tracked & {
  name: string;
  color: string;
  isGroup: boolean;
  /** For a group, whether one or several of its labels can apply; null for a label. */
  selection: "single" | "multi" | null;
  parentId: string | null;
};

export type ProjectLabel = Label & {
  /** The team a team-scoped label belongs to; null for a workspace label. */
  teamId: string | null;
};

export type InitiativeLabel = Label;

export type LatestUpdate = {
  id: string;
  /** The start of the update's text, whitespace collapsed. */
  excerpt: string;
  health: string | null;
  createdAt: string;
};

export type Project = Tracked & {
  name: string;
  slugId: string;
  identifier: string | null;
  url: string;
  statusId: string | null;
  leadId: string | null;
  startDate: string | null;
  targetDate: string | null;
  priority: number;
  health: string | null;
  progress: number;
  teamIds: string[];
  initiativeIds: string[];
  labelIds: string[];
  lastUpdate: LatestUpdate | null;
  createdAt: string;
  completedAt: string | null;
  canceledAt: string | null;
};

export type Initiative = Tracked & {
  name: string;
  slugId: string;
  identifier: string | null;
  url: string;
  status: string;
  ownerId: string | null;
  leadTeamId: string | null;
  targetDate: string | null;
  priority: number;
  health: string | null;
  projectIds: string[];
  labelIds: string[];
  lastUpdate: LatestUpdate | null;
  createdAt: string;
  completedAt: string | null;
};

/** Every entity type the mirror holds, with its record type. */
export type MirrorRecords = {
  teams: Team;
  users: User;
  projectStatuses: ProjectStatus;
  initiativeStatuses: InitiativeStatus;
  projectLabels: ProjectLabel;
  initiativeLabels: InitiativeLabel;
  projects: Project;
  initiatives: Initiative;
};

export type MirrorType = keyof MirrorRecords;

/** In the order feeders apply them: reference data before what refers to it. */
export const mirrorTypes: readonly MirrorType[] = [
  "teams",
  "users",
  "projectStatuses",
  "initiativeStatuses",
  "projectLabels",
  "initiativeLabels",
  "projects",
  "initiatives",
];

/** What the mirror adds to a record when it is read back. */
export type Mirrored<T> = T & {
  /** When the mirror learned Linear no longer returns it; null while it does. */
  removedAt: string | null;
  syncedAt: string;
  syncedSource: SyncSource;
  /** Increases on every write; compare with SyncStatus.version to find what changed. */
  syncSeq: number;
};
