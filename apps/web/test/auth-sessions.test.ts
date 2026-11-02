// Server-side sessions: inactivity expiry, absolute cap, sign-out (MIRROR-R17), and the
// cookie that carries them.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearSessionCookie,
  createSession,
  deleteExpiredSessions,
  deleteSession,
  findSession,
  sessionCookie,
  sessionCookieName,
  sessionLifetime,
} from "../src/server/auth/sessions.ts";
import type { Sql } from "../src/server/db/client.ts";
import { migratedDatabase } from "./auth-fakes.ts";
import { manualClock } from "./linear-fakes.ts";

const secret = "test-session-secret-at-least-32-characters";
const hour = 60 * 60 * 1000;
const day = 24 * hour;

let db: Awaited<ReturnType<typeof migratedDatabase>>;
let sql: Sql;

beforeAll(async () => {
  db = await migratedDatabase("sessions");
  sql = db.sql;
});

afterAll(async () => {
  await db?.drop();
});

beforeEach(async () => {
  await sql`delete from auth_users`;
  await sql`
    insert into auth_users (id, organization_id, name, email, last_sign_in_at)
    values ('user-ada', 'org', 'Ada Lovelace', 'ada@example.com', now())
  `;
});

function setup() {
  const clock = manualClock();
  return { clock, config: { secret, now: clock.now } };
}

describe("sessions", () => {
  it("MIRROR-R17 finds the user of a live session", async () => {
    const { config } = setup();
    const id = await createSession(sql, config, "user-ada");
    expect(await findSession(sql, config, id)).toEqual({
      id: "user-ada",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("MIRROR-R17 stores only a keyed hash of the session id", async () => {
    const { config } = setup();
    const id = await createSession(sql, config, "user-ada");
    const rows = await sql`select * from auth_sessions`;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(id);
    expect(rows[0]?.id_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("MIRROR-R17 a different SESSION_SECRET finds no session, so rotating it signs everyone out", async () => {
    const { config } = setup();
    const id = await createSession(sql, config, "user-ada");
    const rotated = { ...config, secret: "another-session-secret-of-32-characters!" };
    expect(await findSession(sql, rotated, id)).toBeUndefined();
  });

  it("MIRROR-R17 expires after seven days without activity", async () => {
    const { clock, config } = setup();
    const idle = await createSession(sql, config, "user-ada");
    clock.advance(1000);
    const used = await createSession(sql, config, "user-ada");
    clock.advance(sessionLifetime.idleMs - 1000);
    expect(await findSession(sql, config, idle)).toBeUndefined();
    expect(await findSession(sql, config, used)).toBeDefined();
  });

  it("MIRROR-R17 activity slides the inactivity window", async () => {
    const { clock, config } = setup();
    const id = await createSession(sql, config, "user-ada");
    for (let elapsed = 0; elapsed < 20 * day; elapsed += 6 * day) {
      clock.advance(6 * day);
      expect(await findSession(sql, config, id), `after ${elapsed + 6 * day} ms`).toBeDefined();
    }
  });

  it("MIRROR-R17 ends after thirty days however active", async () => {
    const { clock, config } = setup();
    const id = await createSession(sql, config, "user-ada");
    for (let i = 0; i < 4; i++) {
      clock.advance(6 * day);
      expect(await findSession(sql, config, id)).toBeDefined();
    }
    clock.advance(sessionLifetime.absoluteMs - 24 * day - 1000);
    expect(await findSession(sql, config, id)).toBeDefined();
    clock.advance(1000);
    expect(await findSession(sql, config, id)).toBeUndefined();
  });

  it("MIRROR-R17 writes last_seen_at at most once an hour", async () => {
    const { clock, config } = setup();
    const id = await createSession(sql, config, "user-ada");
    const seen = async () =>
      (await sql<{ at: Date }[]>`select last_seen_at as at from auth_sessions`).map((row) =>
        row.at.getTime(),
      )[0];
    const created = clock.now();
    expect(await seen()).toBe(created);
    clock.advance(hour - 1);
    await findSession(sql, config, id);
    expect(await seen()).toBe(created);
    clock.advance(1);
    await findSession(sql, config, id);
    expect(await seen()).toBe(created + hour);
  });

  it("MIRROR-R17 sign-out deletes the session", async () => {
    const { config } = setup();
    const id = await createSession(sql, config, "user-ada");
    const other = await createSession(sql, config, "user-ada");
    await deleteSession(sql, config, id);
    expect(await findSession(sql, config, id)).toBeUndefined();
    expect(await findSession(sql, config, other)).toBeDefined();
  });

  it("MIRROR-R17 ignores missing and malformed cookie values", async () => {
    const { config } = setup();
    expect(await findSession(sql, config, undefined)).toBeUndefined();
    expect(await findSession(sql, config, "")).toBeUndefined();
    expect(await findSession(sql, config, "' or 1=1 --")).toBeUndefined();
  });

  it("MIRROR-R17 purges sessions past either limit", async () => {
    const { clock, config } = setup();
    await createSession(sql, config, "user-ada");
    clock.advance(sessionLifetime.idleMs);
    const live = await createSession(sql, config, "user-ada");
    expect(await deleteExpiredSessions(sql, config)).toBe(1);
    expect(await findSession(sql, config, live)).toBeDefined();
  });
});

describe("session cookie", () => {
  it("MIRROR-R17 is HttpOnly, SameSite=Lax, Path=/ and Secure with __Host- on https", () => {
    const cookie = sessionCookie("https://linear.sesv.co", "abc");
    expect(sessionCookieName("https://linear.sesv.co")).toBe("__Host-linear_session");
    expect(cookie).toBe(
      `__Host-linear_session=abc; Path=/; Max-Age=${sessionLifetime.absoluteMs / 1000}; ` +
        "HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("MIRROR-R17 drops Secure and the prefix only for a plain-http PUBLIC_URL", () => {
    expect(sessionCookie("http://localhost:3000", "abc")).toMatch(
      /^linear_session=abc; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax$/,
    );
  });

  it("MIRROR-R17 clearing the cookie expires it at once", () => {
    expect(clearSessionCookie("https://linear.sesv.co")).toBe(
      "__Host-linear_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    );
  });
});
