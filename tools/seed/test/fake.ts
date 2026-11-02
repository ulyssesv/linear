// In-memory Linear behind the SeedApi port: applies writes to a workspace and logs each one.
import {
  type LabelCreateInput,
  type LabelUpdateInput,
  RateLimitedError,
  type SeedApi,
  type Workspace,
} from "../src/model.ts";

export type WriteRecord = { method: string; id: string };

export type FakeOptions = {
  /** Throw on the call for this entity id. */
  failOn?: Set<string>;
  /** Rate-limit the first N write calls with this wait. */
  rateLimit?: { times: number; waitMs: number };
};

export function fakeLinear(initial: Workspace, options: FakeOptions = {}) {
  const state: Workspace = structuredClone(initial);
  const writes: WriteRecord[] = [];
  let reads = 0;
  let limited = options.rateLimit?.times ?? 0;
  let clock = 0;

  const write = (method: string, id: string) => {
    if (limited > 0) {
      limited--;
      throw new RateLimitedError(options.rateLimit?.waitMs ?? 1000);
    }
    if (options.failOn?.has(id)) throw new Error(`Linear refused ${method} ${id}`);
    writes.push({ method, id });
  };

  const createLabel = (list: "projectLabels" | "initiativeLabels", input: LabelCreateInput) => {
    state[list].push({
      id: input.id,
      name: input.name,
      isGroup: input.isGroup,
      groupType: input.groupType ?? null,
      parentId: input.parentId ?? null,
      teamId: null,
      color: input.color,
      description: input.description,
      retiredAt: null,
    });
  };
  const updateLabel = (
    list: "projectLabels" | "initiativeLabels",
    id: string,
    input: LabelUpdateInput,
  ) => {
    const found = state[list].find((l) => l.id === id);
    if (!found) throw new Error(`no label ${id}`);
    Object.assign(found, input);
  };
  const createdAt = () => new Date(Date.UTC(2026, 10, 1) + clock++ * 1000).toISOString();

  const api: SeedApi = {
    async readWorkspace() {
      reads++;
      return structuredClone(state);
    },
    async createProjectLabel(input) {
      write("createProjectLabel", input.id);
      createLabel("projectLabels", input);
    },
    async updateProjectLabel(id, input) {
      write("updateProjectLabel", id);
      updateLabel("projectLabels", id, input);
    },
    async createInitiativeLabel(input) {
      write("createInitiativeLabel", input.id);
      createLabel("initiativeLabels", input);
    },
    async updateInitiativeLabel(id, input) {
      write("updateInitiativeLabel", id);
      updateLabel("initiativeLabels", id, input);
    },
    async createProject(input) {
      write("createProject", input.id);
      state.projects.push({ ...input, createdAt: createdAt(), trashed: false });
    },
    async updateProject(id, input) {
      write("updateProject", id);
      const found = state.projects.find((p) => p.id === id);
      if (!found) throw new Error(`no project ${id}`);
      Object.assign(found, input);
    },
    async createInitiative(input) {
      write("createInitiative", input.id);
      state.initiatives.push({ ...input, createdAt: createdAt(), trashed: false });
    },
    async updateInitiative(id, input) {
      write("updateInitiative", id);
      const found = state.initiatives.find((i) => i.id === id);
      if (!found) throw new Error(`no initiative ${id}`);
      Object.assign(found, input);
    },
    async linkProject(input) {
      write("linkProject", `${input.initiativeId}>${input.projectId}`);
      state.links.push({ ...input });
    },
  };
  return { api, state, writes, reads: () => reads };
}
