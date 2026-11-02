// Server-side sessions (MIRROR-R15, MIRROR-R17). The cookie carries 32 random bytes; the
// database keeps only HMAC-SHA256(SESSION_SECRET, id), so a copy of the table cannot be
// replayed as cookies and rotating SESSION_SECRET ends every session at once.
//
// A session ends after `idleMs` without a request (sliding; last_seen_at is written at
// most once per `touchMs`), after `absoluteMs` whatever the activity, or on sign-out.
import { createHmac, randomBytes } from "node:crypto";
import type postgres from "postgres";
import type { Sql } from "../db/client.ts";
import { clearCookie, isSecureOrigin, serializeCookie } from "./cookies.ts";

const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

export const sessionLifetime = {
  /** Inactivity after which a session ends. */
  idleMs: 7 * day,
  /** Hard cap from sign-in, however active the session is. */
  absoluteMs: 30 * day,
  /** last_seen_at is refreshed at most this often, so reads stay reads. */
  touchMs: hour,
} as const;

/** The pool or a transaction on it. */
export type Queryable = Sql | postgres.TransactionSql;

export type SessionUser = { id: string; name: string; email: string };

export type SessionConfig = {
  /** SESSION_SECRET. */
  secret: string;
  now?: () => number;
};

/**
 * `__Host-` binds the cookie to this exact origin, but browsers accept it only with Secure,
 * so plain-http development uses the bare name.
 */
export function sessionCookieName(publicUrl: string): string {
  return isSecureOrigin(publicUrl) ? "__Host-linear_session" : "linear_session";
}

export function sessionCookie(publicUrl: string, id: string): string {
  return serializeCookie(sessionCookieName(publicUrl), id, {
    secure: isSecureOrigin(publicUrl),
    maxAge: sessionLifetime.absoluteMs / 1000,
  });
}

export function clearSessionCookie(publicUrl: string): string {
  return clearCookie(sessionCookieName(publicUrl), { secure: isSecureOrigin(publicUrl) });
}

const idPattern = /^[A-Za-z0-9_-]{43}$/;

function hashId(secret: string, id: string): string {
  return createHmac("sha256", secret).update(id).digest("hex");
}

/** Starts a session for an existing auth_users row and returns the cookie value. */
export async function createSession(
  sql: Queryable,
  config: SessionConfig,
  userId: string,
): Promise<string> {
  const now = new Date((config.now ?? Date.now)());
  const id = randomBytes(32).toString("base64url");
  await sql`
    insert into auth_sessions (id_hash, user_id, created_at, last_seen_at)
    values (${hashId(config.secret, id)}, ${userId}, ${now}, ${now})
  `;
  return id;
}

/** The signed-in user for a cookie value, or undefined when it names no live session. */
export async function findSession(
  sql: Queryable,
  config: SessionConfig,
  id: string | undefined,
): Promise<SessionUser | undefined> {
  if (!id || !idPattern.test(id)) return undefined;
  const at = (config.now ?? Date.now)();
  const idleSince = new Date(at - sessionLifetime.idleMs);
  const createdSince = new Date(at - sessionLifetime.absoluteMs);
  const idHash = hashId(config.secret, id);
  const [row] = await sql<{ id: string; name: string; email: string; last_seen_at: Date }[]>`
    select u.id, u.name, u.email, s.last_seen_at
    from auth_sessions s join auth_users u on u.id = s.user_id
    where s.id_hash = ${idHash}
      and s.last_seen_at > ${idleSince}
      and s.created_at > ${createdSince}
  `;
  if (!row) return undefined;
  if (at - row.last_seen_at.getTime() >= sessionLifetime.touchMs) {
    await sql`
      update auth_sessions set last_seen_at = ${new Date(at)}
      where id_hash = ${idHash} and last_seen_at < ${new Date(at)}
    `;
  }
  return { id: row.id, name: row.name, email: row.email };
}

/** Ends the session a cookie value names, if any. */
export async function deleteSession(
  sql: Queryable,
  config: SessionConfig,
  id: string | undefined,
): Promise<void> {
  if (!id || !idPattern.test(id)) return;
  await sql`delete from auth_sessions where id_hash = ${hashId(config.secret, id)}`;
}

/** Removes every session past either limit. Called on sign-in; nothing else needs it. */
export async function deleteExpiredSessions(sql: Sql, config: SessionConfig): Promise<number> {
  const at = (config.now ?? Date.now)();
  const result = await sql`
    delete from auth_sessions
    where last_seen_at <= ${new Date(at - sessionLifetime.idleMs)}
       or created_at <= ${new Date(at - sessionLifetime.absoluteMs)}
  `;
  return result.count;
}
