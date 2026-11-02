// Signature, timestamp and payload normalisation of Linear webhooks, without a database
// (MIRROR-R11, MIRROR-R12).
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { scopeInitiative } from "../src/server/mirror/scope.ts";
import type { Initiative, Project } from "../src/server/mirror/types.ts";
import {
  initiativeFromPayload,
  isTrashed,
  PayloadError,
  parseEvent,
  projectFromPayload,
  updateFromPayload,
} from "../src/server/webhooks/payload.ts";
import {
  replayWindowMs,
  sign,
  signatureMatches,
  timestampFresh,
} from "../src/server/webhooks/verify.ts";
import {
  envelope,
  initiativeData,
  initiativeUpdateData,
  projectData,
  projectUpdateData,
  sentAt,
  webhookSecret,
} from "./webhook-fixtures.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("webhook signature", () => {
  const body = JSON.stringify(envelope("Project", "update", projectData("p1")));

  it("MIRROR-R11 is the hex HMAC-SHA256 of the raw body with the signing secret", () => {
    const expected = createHmac("sha256", webhookSecret).update(body).digest("hex");
    expect(sign(body, webhookSecret)).toBe(expected);
    expect(signatureMatches(bytes(body), expected, webhookSecret)).toBe(true);
    expect(signatureMatches(bytes(body), expected.toUpperCase(), webhookSecret)).toBe(true);
  });

  it("MIRROR-R11 rejects an unsigned, mis-signed or re-serialised body", () => {
    const good = sign(body, webhookSecret);
    expect(signatureMatches(bytes(body), null, webhookSecret)).toBe(false);
    expect(signatureMatches(bytes(body), "", webhookSecret)).toBe(false);
    expect(signatureMatches(bytes(body), sign(body, "another-secret"), webhookSecret)).toBe(false);
    expect(signatureMatches(bytes(body), good.slice(0, -2), webhookSecret)).toBe(false);
    expect(signatureMatches(bytes(`${body} `), good, webhookSecret)).toBe(false);
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(signatureMatches(bytes(reserialised), good, webhookSecret)).toBe(false);
    expect(signatureMatches(bytes(body), good, "")).toBe(false);
  });

  it("MIRROR-R11 accepts a webhookTimestamp within a minute of the clock, either way", () => {
    expect(timestampFresh(sentAt, sentAt)).toBe(true);
    expect(timestampFresh(sentAt, sentAt + replayWindowMs)).toBe(true);
    expect(timestampFresh(sentAt, sentAt - replayWindowMs)).toBe(true);
    expect(timestampFresh(sentAt, sentAt + replayWindowMs + 1)).toBe(false);
    expect(timestampFresh(sentAt + replayWindowMs + 1, sentAt)).toBe(false);
    expect(timestampFresh(undefined, sentAt)).toBe(false);
    expect(timestampFresh(String(sentAt), sentAt)).toBe(false);
    expect(timestampFresh(Number.NaN, sentAt)).toBe(false);
  });
});

describe("webhook envelope", () => {
  it("MIRROR-R11 reads action, type, data and the signed timestamp", () => {
    const event = parseEvent(JSON.stringify(envelope("Project", "create", projectData("p9"))));
    expect(event).toMatchObject({
      action: "create",
      type: "Project",
      webhookTimestamp: sentAt,
      data: { id: "p9" },
    });
  });

  it("MIRROR-R11 refuses a body that is not JSON or not an envelope", () => {
    expect(() => parseEvent("{not json")).toThrow(PayloadError);
    expect(() => parseEvent("[]")).toThrow(PayloadError);
    expect(() => parseEvent(JSON.stringify({ type: "Project" }))).toThrow(PayloadError);
  });
});

const storedProject: Project = {
  id: "p1",
  name: "Old name",
  slugId: "p1-slug",
  identifier: "P-TST-p1",
  url: "https://linear.app/sesv/project/p1-slug",
  statusId: "status-backlog",
  leadId: "user-ana",
  startDate: null,
  targetDate: null,
  priority: 0,
  health: null,
  progress: 0.4,
  teamIds: ["team-test"],
  initiativeIds: ["i1", "i2"],
  labelIds: [],
  lastUpdate: {
    id: "pu-1",
    excerpt: "Stored",
    health: "onTrack",
    createdAt: "2026-11-01T00:00:00.000Z",
  },
  createdAt: "2026-11-01T00:00:00.000Z",
  completedAt: null,
  canceledAt: null,
  updatedAt: "2026-11-01T00:00:00.000Z",
  archivedAt: null,
};

describe("project payload", () => {
  it("MIRROR-R11 maps the flat ids and fields of a Project event", () => {
    const record = projectFromPayload(projectData("p1"), null);
    expect(record).toEqual({
      id: "p1",
      updatedAt: "2026-11-02T11:00:00.000Z",
      archivedAt: null,
      name: "Project p1",
      slugId: "p1-slug",
      identifier: "P-TST-p1",
      url: "https://linear.app/sesv/project/p1-slug",
      statusId: "status-started",
      leadId: "user-ben",
      startDate: "2026-11-01",
      targetDate: "2027-01-31",
      priority: 2,
      health: "atRisk",
      progress: 0,
      teamIds: ["team-test"],
      initiativeIds: ["i1"],
      labelIds: ["plabel-bet"],
      lastUpdate: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      completedAt: null,
      canceledAt: null,
    });
  });

  it("MIRROR-R11 keeps progress, the latest update and absent initiatives from the stored row", () => {
    const data = projectData("p1", { lastUpdateId: "pu-2" });
    delete data.initiatives;
    const record = projectFromPayload(data, storedProject);
    expect(record.progress).toBe(0.4);
    expect(record.lastUpdate).toEqual(storedProject.lastUpdate);
    expect(record.initiativeIds).toEqual(["i1", "i2"]);
    expect(
      projectFromPayload(projectData("p1", { initiatives: [] }), storedProject).initiativeIds,
    ).toEqual([]);
  });

  it("MIRROR-R11 clears the latest update when the payload says there is none", () => {
    expect(
      projectFromPayload(projectData("p1", { lastUpdateId: null }), storedProject).lastUpdate,
    ).toBeNull();
  });

  it("MIRROR-R11 falls back to the child objects when a flat id is absent", () => {
    const data = projectData("p1");
    delete data.leadId;
    delete data.statusId;
    expect(projectFromPayload(data, null)).toMatchObject({
      leadId: "user-ben",
      statusId: "status-started",
    });
  });

  it("MIRROR-R11 refuses a payload without id or updatedAt", () => {
    expect(() => projectFromPayload(projectData("p1", { id: null }), null)).toThrow(PayloadError);
    expect(() => projectFromPayload(projectData("p1", { updatedAt: undefined }), null)).toThrow(
      PayloadError,
    );
  });

  it("MIRROR-R11 sees a trashed entity", () => {
    expect(isTrashed(projectData("p1", { trashed: true }))).toBe(true);
    expect(isTrashed(projectData("p1"))).toBe(false);
  });
});

describe("initiative payload", () => {
  const stored = { projectIds: ["p1", "p2"], lastUpdate: null } as unknown as Initiative;

  it("MIRROR-R11 maps an Initiative event", () => {
    expect(initiativeFromPayload(initiativeData("i1"), null)).toEqual({
      id: "i1",
      updatedAt: "2026-11-02T11:00:00.000Z",
      archivedAt: null,
      name: "Initiative i1",
      slugId: "i1-slug",
      identifier: "I-i1",
      url: "https://linear.app/sesv/initiative/i1-slug",
      status: "Active",
      ownerId: "user-ben",
      leadTeamId: "team-test",
      targetDate: "2027-03-31",
      priority: 1,
      health: "onTrack",
      projectIds: ["p1"],
      labelIds: ["ilabel-pillar"],
      lastUpdate: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      completedAt: null,
    });
  });

  it("MIRROR-R11 keeps the stored project ids when the payload has no projects", () => {
    const data = initiativeData("i1");
    delete data.projects;
    expect(initiativeFromPayload(data, stored).projectIds).toEqual(["p1", "p2"]);
  });

  it("MIRROR-R12 scopes on visibility when the payload carries it, on the lead team otherwise", () => {
    const teams = new Set(["team-test"]);
    const hidden = initiativeFromPayload(initiativeData("i1", { visibility: "private" }), null);
    expect(scopeInitiative(hidden, teams)).toBeNull();
    const sandbox = initiativeFromPayload(initiativeData("i1", { leadTeamId: "team-sbx" }), null);
    expect(scopeInitiative(sandbox, teams)).toBeNull();
    const plain = initiativeFromPayload(initiativeData("i1", { leadTeamId: null }), null);
    expect(scopeInitiative(plain, teams)).not.toBeNull();
  });
});

describe("update payloads", () => {
  it("MIRROR-R11 reads a ProjectUpdate as its project's latest update", () => {
    expect(updateFromPayload(projectUpdateData("pu-2", "p1"), "project")).toEqual({
      parentId: "p1",
      update: {
        id: "pu-2",
        excerpt: "We are **on track**. Next: the beta.",
        health: "onTrack",
        createdAt: "2026-11-02T09:00:00.000Z",
      },
      gone: false,
    });
  });

  it("MIRROR-R11 reads an InitiativeUpdate, and an archived one as gone", () => {
    const archived = initiativeUpdateData("iu-2", "i1", { archivedAt: "2026-11-02T10:00:00.000Z" });
    expect(updateFromPayload(archived, "initiative")).toMatchObject({
      parentId: "i1",
      update: { id: "iu-2" },
      gone: true,
    });
  });

  it("MIRROR-R11 refuses an update without its parent", () => {
    const data = projectUpdateData("pu-2", "p1");
    delete data.projectId;
    delete data.project;
    expect(() => updateFromPayload(data, "project")).toThrow(PayloadError);
  });
});
