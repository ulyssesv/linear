// Recorded-shape Linear webhook deliveries for the receiver tests (MIRROR-R11). Envelopes
// and `data` follow https://linear.app/developers/webhooks and the webhook payload types of
// @linear/sdk 98.0.0 (EntityWebhookPayload, ProjectWebhookPayload, InitiativeWebhookPayload,
// ProjectUpdateWebhookPayload, InitiativeUpdateWebhookPayload), including the fields the
// mirror ignores, so a test sees what Linear really sends. Ids match mirror-fixtures.ts:
// team-test, team-test-a and team-ops are public, team-sbx is the private Sandbox team.
import { sign } from "../src/server/webhooks/verify.ts";

export type Payload = Record<string, unknown>;

export const webhookSecret = "lin_wh_test0123456789abcdef";
export const organizationId = "8f2a6c1e-5d3b-4a7e-9c0f-1b2d3e4f5a6b";
/** When the deliveries below were sent; the receiver's clock in the tests. */
export const sentAt = Date.parse("2026-11-02T12:00:00.000Z");

const at = (day: number, hour = 0) => new Date(Date.UTC(2026, 10, day, hour)).toISOString();

const actor = {
  id: "user-ana",
  name: "Ana",
  email: "ana@example.com",
  url: "https://linear.app/sesv/profiles/ana",
  type: "user",
};

export function envelope(
  type: string,
  action: "create" | "update" | "remove" | string,
  data: Payload,
  options: { updatedFrom?: Payload; timestamp?: number } = {},
): Payload {
  return {
    action,
    actor,
    createdAt: at(2, 12),
    data,
    url: typeof data.url === "string" ? data.url : undefined,
    type,
    ...(options.updatedFrom ? { updatedFrom: options.updatedFrom } : {}),
    organizationId,
    webhookTimestamp: options.timestamp ?? sentAt,
    webhookId: "0c1d7e52-7f5e-4c34-9a1b-3e2f4d5c6b7a",
  };
}

export function projectData(id: string, overrides: Payload = {}): Payload {
  return {
    id,
    createdAt: at(1),
    updatedAt: at(2, 11),
    archivedAt: null,
    autoArchivedAt: null,
    canceledAt: null,
    completedAt: null,
    name: `Project ${id}`,
    description: "Short summary",
    slugId: `${id}-slug`,
    identifier: `P-TST-${id}`,
    color: "#bec2c8",
    icon: null,
    content: "Long **markdown** description",
    documentContentId: "doc-content-1",
    convertedFromIssueId: null,
    lastAppliedTemplateId: null,
    priority: 2,
    prioritySortOrder: 0,
    sortOrder: 1000,
    startDate: "2026-11-01",
    startDateResolution: null,
    targetDate: "2027-01-31",
    targetDateResolution: "month",
    startedAt: at(1),
    health: "atRisk",
    healthUpdatedAt: at(2),
    lastUpdateId: null,
    creatorId: "user-ana",
    leadId: "user-ben",
    lead: { id: "user-ben", name: "Ben", email: "ben@example.com", avatarUrl: null },
    statusId: "status-started",
    status: { id: "status-started", name: "In progress", color: "#f2c94c", type: "started" },
    memberIds: ["user-ana", "user-ben"],
    teamIds: ["team-test"],
    labelIds: ["plabel-bet"],
    initiatives: [
      { id: "i1", name: "Initiative i1", url: "https://linear.app/sesv/initiative/i1-slug" },
    ],
    milestones: [],
    scopeHistory: [0, 3, 5],
    completedScopeHistory: [0, 1, 2],
    inProgressScopeHistory: [0, 1, 1],
    issueCountHistory: [0, 3, 5],
    completedIssueCountHistory: [0, 1, 2],
    previousIdentifiers: [],
    projectUpdateRemindersPausedUntilAt: null,
    syncedWith: null,
    trashed: null,
    url: `https://linear.app/sesv/project/${id}-slug`,
    ...overrides,
  };
}

export function initiativeData(id: string, overrides: Payload = {}): Payload {
  return {
    id,
    createdAt: at(1),
    updatedAt: at(2, 11),
    archivedAt: null,
    canceledAt: null,
    completedAt: null,
    startedAt: at(1),
    name: `Initiative ${id}`,
    description: "Why this matters",
    slugId: `${id}-slug`,
    identifier: `I-${id}`,
    color: "#5e6ad2",
    icon: "Target",
    status: "Active",
    priority: 1,
    sortOrder: 10,
    targetDate: "2027-03-31",
    targetDateResolution: "quarter",
    health: "onTrack",
    healthUpdatedAt: at(2),
    frequencyResolution: "weekly",
    updateReminderFrequency: 1,
    updateReminderFrequencyInWeeks: 1,
    updateRemindersDay: 5,
    updateRemindersHour: 9,
    organizationId,
    creatorId: "user-ana",
    creator: { id: "user-ana", name: "Ana", email: "ana@example.com", avatarUrl: null },
    ownerId: "user-ben",
    owner: { id: "user-ben", name: "Ben", email: "ben@example.com", avatarUrl: null },
    leadTeamId: "team-test",
    labelIds: ["ilabel-pillar"],
    lastUpdateId: null,
    lastUpdate: null,
    parentInitiative: null,
    parentInitiatives: [],
    subInitiatives: [],
    previousIdentifiers: [],
    projects: [{ id: "p1", name: "Project p1", url: "https://linear.app/sesv/project/p1-slug" }],
    trashed: null,
    url: `https://linear.app/sesv/initiative/${id}-slug`,
    ...overrides,
  };
}

function updateData(id: string, overrides: Payload): Payload {
  return {
    id,
    createdAt: at(2, 9),
    updatedAt: at(2, 9),
    editedAt: at(2, 9),
    archivedAt: null,
    body: "We are **on track**.\n\nNext: the beta.",
    bodyData: '{"type":"doc","content":[]}',
    diffMarkdown: null,
    health: "onTrack",
    reactionData: [],
    slugId: `${id}-slug`,
    userId: "user-ana",
    user: { id: "user-ana", name: "Ana", email: "ana@example.com", avatarUrl: null },
    ...overrides,
  };
}

export function projectUpdateData(id: string, projectId: string, overrides: Payload = {}) {
  return updateData(id, {
    projectId,
    project: {
      id: projectId,
      name: `Project ${projectId}`,
      url: `https://linear.app/sesv/project/${projectId}-slug`,
    },
    url: `https://linear.app/sesv/project/${projectId}-slug/updates#${id}`,
    ...overrides,
  });
}

export function initiativeUpdateData(id: string, initiativeId: string, overrides: Payload = {}) {
  return updateData(id, {
    initiativeId,
    initiative: {
      id: initiativeId,
      name: `Initiative ${initiativeId}`,
      url: `https://linear.app/sesv/initiative/${initiativeId}-slug`,
    },
    url: `https://linear.app/sesv/initiative/${initiativeId}-slug/updates#${id}`,
    ...overrides,
  });
}

let deliveries = 0;

/** A fresh Linear-Delivery id, a UUID as Linear sends. */
export function deliveryId(): string {
  deliveries += 1;
  return `00000000-0000-4000-8000-${deliveries.toString(16).padStart(12, "0")}`;
}

export type DeliveryOptions = {
  secret?: string;
  /** Overrides the computed signature; null leaves the header out. */
  signature?: string | null;
  delivery?: string | null;
  url?: string;
};

/** A POST as Linear sends it: raw JSON body, signature over those bytes, delivery headers. */
export function delivery(body: Payload | string, options: DeliveryOptions = {}): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "accept-charset": "utf-8",
    "user-agent": "Linear-Webhook",
  });
  const signature =
    options.signature === undefined
      ? sign(raw, options.secret ?? webhookSecret)
      : options.signature;
  if (signature !== null) headers.set("linear-signature", signature);
  const id = options.delivery === undefined ? deliveryId() : options.delivery;
  if (id !== null) headers.set("linear-delivery", id);
  if (typeof body !== "string" && typeof body.type === "string") {
    headers.set("linear-event", body.type);
  }
  if (typeof body !== "string" && typeof body.webhookTimestamp === "number") {
    headers.set("linear-timestamp", String(body.webhookTimestamp));
  }
  return new Request(options.url ?? "https://linear.sesv.co/webhooks/linear", {
    method: "POST",
    headers,
    body: raw,
  });
}
