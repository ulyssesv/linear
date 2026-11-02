// The workspace as the seed tool sees it, the writes it may make, and the port to Linear.
// Field names follow the Linear GraphQL schema in @linear/sdk 98.0.0 (ProjectCreateInput,
// InitiativeCreateInput, ProjectLabelCreateInput, InitiativeLabelCreateInput,
// InitiativeToProjectCreateInput and their update counterparts).

export const PROJECT_STATUS_TYPES = [
  "backlog",
  "planned",
  "started",
  "paused",
  "completed",
  "canceled",
] as const;
export type ProjectStatusType = (typeof PROJECT_STATUS_TYPES)[number];

/** The initiative statuses the fixture workspace offers. The schema also knows Proposed and
 * Canceled, which the workspace does not use; the fixtures stay within these three. */
export const INITIATIVE_STATUSES = ["Planned", "Active", "Completed"] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

export type GroupType = "singleSelect" | "multiSelect";

export type Team = {
  id: string;
  key: string;
  name: string;
  private: boolean;
  parentId: string | null;
};

export type User = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  guest: boolean;
  app: boolean;
};

export type ProjectStatus = {
  id: string;
  name: string;
  type: string;
  position: number;
  teamId: string | null;
};

/** A project label or an initiative label; groups have `isGroup` and children a `parentId`. */
export type Label = {
  id: string;
  name: string;
  isGroup: boolean;
  groupType: GroupType | null;
  parentId: string | null;
  teamId: string | null;
  color: string;
  description: string | null;
  retiredAt: string | null;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  statusId: string;
  leadId: string | null;
  leadTeamId: string | null;
  teamIds: string[];
  startDate: string | null;
  targetDate: string | null;
  priority: number;
  labelIds: string[];
  createdAt: string;
  trashed: boolean;
};

export type Initiative = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  ownerId: string | null;
  leadTeamId: string | null;
  targetDate: string | null;
  priority: number;
  labelIds: string[];
  createdAt: string;
  trashed: boolean;
};

export type Link = { initiativeId: string; projectId: string };

/** Everything the planner reads, fetched once before planning. */
export type Workspace = {
  teams: Team[];
  users: User[];
  projectStatuses: ProjectStatus[];
  projectLabels: Label[];
  initiativeLabels: Label[];
  projects: Project[];
  initiatives: Initiative[];
  links: Link[];
};

export type LabelCreateInput = {
  id: string;
  name: string;
  description: string;
  color: string;
  isGroup: boolean;
  groupType?: GroupType;
  parentId?: string;
};
export type LabelUpdateInput = Partial<Omit<LabelCreateInput, "id">>;

export type ProjectCreateInput = {
  id: string;
  name: string;
  description: string;
  teamIds: string[];
  leadTeamId: string;
  statusId: string;
  leadId: string | null;
  startDate: string | null;
  targetDate: string | null;
  priority: number;
  labelIds: string[];
};
export type ProjectUpdateInput = Partial<Omit<ProjectCreateInput, "id">>;

export type InitiativeCreateInput = {
  id: string;
  name: string;
  description: string;
  status: InitiativeStatus;
  ownerId: string | null;
  leadTeamId: string | null;
  targetDate: string | null;
  priority: number;
  labelIds: string[];
};
export type InitiativeUpdateInput = Partial<Omit<InitiativeCreateInput, "id">>;

export type LinkCreateInput = { initiativeId: string; projectId: string };

/**
 * The calls the seed tool makes. There is deliberately no way to delete anything or to
 * write a team: the tool cannot do what the port does not offer (MIRROR-R27, MIRROR-R28).
 */
export interface SeedApi {
  readWorkspace(): Promise<Workspace>;
  createProjectLabel(input: LabelCreateInput): Promise<void>;
  updateProjectLabel(id: string, input: LabelUpdateInput): Promise<void>;
  createInitiativeLabel(input: LabelCreateInput): Promise<void>;
  updateInitiativeLabel(id: string, input: LabelUpdateInput): Promise<void>;
  createProject(input: ProjectCreateInput): Promise<void>;
  updateProject(id: string, input: ProjectUpdateInput): Promise<void>;
  createInitiative(input: InitiativeCreateInput): Promise<void>;
  updateInitiative(id: string, input: InitiativeUpdateInput): Promise<void>;
  linkProject(input: LinkCreateInput): Promise<void>;
}

/** Thrown by a port call when Linear rate-limits it; `waitMs` is how long to pause. */
export class RateLimitedError extends Error {
  readonly waitMs: number;
  constructor(waitMs: number, message = `rate limited, retry in ${Math.ceil(waitMs / 1000)}s`) {
    super(message);
    this.name = "RateLimitedError";
    this.waitMs = waitMs;
  }
}
