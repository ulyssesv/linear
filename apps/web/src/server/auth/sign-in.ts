// The sign-in, callback and sign-out handlers (MIRROR-R16, MIRROR-R17), on plain Request
// and Response so tests drive them without the framework or the network.
//
// Accepted: the Linear user's organization is the one the OAuth app is installed in
// (learned from the app's own token, REC-005), the user is not a guest, and, when
// SIGNIN_ALLOWLIST is set, their lowercased email is on it. Anything else is refused: the
// user is sent back to the sign-in page with a reason, no session is created, nothing is
// stored, and the tokens Linear just issued are revoked.
//
// Log lines name the Linear user id and the outcome; never a token, code or email.
import { type SignInError, safeNext, signInPath } from "../../auth.ts";
import type { Sql } from "../db/client.ts";
import type { Env } from "../env.ts";
import { createLinearClient } from "../linear/client.ts";
import { clearCookie, isSecureOrigin, parseCookies } from "./cookies.ts";
import {
  authorizeUrl,
  decodeAttempt,
  exchangeCode,
  newSignInAttempt,
  revokeToken,
  stateCookie,
  stateCookieName,
  stateMatches,
  type UserTokens,
} from "./linear-oauth.ts";
import {
  clearSessionCookie,
  createSession,
  deleteExpiredSessions,
  deleteSession,
  sessionCookie,
  sessionCookieName,
} from "./sessions.ts";
import type { TokenCipher } from "./token-cipher.ts";
import { storeUserTokens } from "./user-tokens.ts";

export type AuthEnv = Pick<
  Env,
  "PUBLIC_URL" | "LINEAR_CLIENT_ID" | "LINEAR_CLIENT_SECRET" | "SESSION_SECRET" | "SIGNIN_ALLOWLIST"
>;

export type LogEntry = { event: string } & Record<string, unknown>;

export type AuthDeps = {
  env: AuthEnv;
  sql: Sql;
  cipher: TokenCipher;
  /** Organization id of the workspace the OAuth app is installed in. */
  appOrganizationId: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  log?: (entry: LogEntry) => void;
};

export type Viewer = {
  id: string;
  name: string;
  email: string;
  guest: boolean;
  organization: { id: string };
};

export type SignInDecision = { ok: true } | { ok: false; reason: SignInError };

/** The acceptance rule of MIRROR-R16. */
export function decideSignIn(
  viewer: Viewer,
  appOrganizationId: string,
  allowlist: readonly string[] | undefined,
): SignInDecision {
  if (viewer.organization.id !== appOrganizationId) {
    return { ok: false, reason: "not-in-workspace" };
  }
  if (viewer.guest) return { ok: false, reason: "guest" };
  if (allowlist && !allowlist.includes(viewer.email.trim().toLowerCase())) {
    return { ok: false, reason: "not-allowed" };
  }
  return { ok: true };
}

const viewerQuery = `query SignInViewer {
  viewer { id name email guest organization { id } }
}`;

/** Who the user token belongs to, read with that token. */
export async function fetchViewer(
  fetch: typeof globalThis.fetch,
  accessToken: string,
): Promise<Viewer> {
  const client = createLinearClient({
    fetch,
    tokens: { getToken: async () => accessToken, invalidate: () => {} },
    maxRateLimitRetries: 1,
    maxWaitMs: 5_000,
  });
  const { viewer } = await client.request<{ viewer: Viewer }>(viewerQuery);
  return viewer;
}

const noStore = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

function redirect(location: string, status: number, cookies: string[]): Response {
  const headers = new Headers({ ...noStore, location });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status, headers });
}

function absolute(env: Pick<AuthEnv, "PUBLIC_URL">, path: string): string {
  return new URL(path, env.PUBLIC_URL).href;
}

const defaultLog = (entry: LogEntry) => console.info(JSON.stringify(entry));

/** GET /auth/linear/sign-in: remember the attempt in a cookie and go to Linear. */
export function handleSignInStart(request: Request, deps: AuthDeps): Response {
  const now = (deps.now ?? Date.now)();
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  const attempt = newSignInAttempt(next, now);
  return redirect(authorizeUrl(deps.env, attempt), 302, [
    stateCookie(deps.env.PUBLIC_URL, deps.env.SESSION_SECRET, attempt),
  ]);
}

/** GET /auth/linear/callback: verify the attempt, ask Linear who this is, decide. */
export async function handleCallback(request: Request, deps: AuthDeps): Promise<Response> {
  const { env, sql } = deps;
  const fetch = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? defaultLog;
  const secure = isSecureOrigin(env.PUBLIC_URL);
  const params = new URL(request.url).searchParams;
  const cookies = parseCookies(request.headers.get("cookie"));
  // The attempt is single-use: whatever happens, its cookie goes.
  const clearState = clearCookie(stateCookieName(env.PUBLIC_URL), { secure });
  const refuse = (reason: SignInError) =>
    redirect(absolute(env, `${signInPath}?error=${reason}`), 302, [clearState]);

  const attempt = decodeAttempt(
    env.SESSION_SECRET,
    cookies.get(stateCookieName(env.PUBLIC_URL)),
    now(),
  );
  if (!attempt || !stateMatches(attempt, params.get("state"))) {
    log({ event: "auth.sign_in", outcome: "refused", reason: "state" });
    return refuse("state");
  }
  if (params.get("error")) {
    log({ event: "auth.sign_in", outcome: "refused", reason: "denied" });
    return refuse("denied");
  }
  const code = params.get("code");
  if (!code) {
    log({ event: "auth.sign_in", outcome: "failed", error: "callback without a code" });
    return refuse("failed");
  }

  let tokens: UserTokens;
  try {
    tokens = await exchangeCode(fetch, env, code, attempt.verifier, now());
  } catch (error) {
    log({ event: "auth.sign_in", outcome: "failed", error: errorText(error) });
    return refuse("failed");
  }
  const revoke = async () => {
    await revokeToken(fetch, tokens.accessToken, "access_token");
    if (tokens.refreshToken) await revokeToken(fetch, tokens.refreshToken, "refresh_token");
  };

  let viewer: Viewer;
  let decision: SignInDecision;
  try {
    viewer = await fetchViewer(fetch, tokens.accessToken);
    decision = decideSignIn(viewer, await deps.appOrganizationId(), env.SIGNIN_ALLOWLIST);
  } catch (error) {
    log({ event: "auth.sign_in", outcome: "failed", error: errorText(error) });
    await revoke();
    return refuse("failed");
  }
  if (!decision.ok) {
    log({ event: "auth.sign_in", outcome: "refused", reason: decision.reason, user: viewer.id });
    await revoke();
    return refuse(decision.reason);
  }

  const previous = cookies.get(sessionCookieName(env.PUBLIC_URL));
  const config = { secret: env.SESSION_SECRET, now };
  let sessionId: string;
  try {
    sessionId = await sql.begin(async (tx) => {
      const at = new Date(now());
      await tx`
        insert into auth_users (id, organization_id, name, email, last_sign_in_at)
        values (${viewer.id}, ${viewer.organization.id}, ${viewer.name}, ${viewer.email}, ${at})
        on conflict (id) do update set
          organization_id = excluded.organization_id,
          name = excluded.name,
          email = excluded.email,
          last_sign_in_at = excluded.last_sign_in_at
      `;
      await storeUserTokens(tx, deps.cipher, viewer.id, tokens, now());
      // A fresh id on every sign-in; a session planted before it does not carry over.
      await deleteSession(tx, config, previous);
      return createSession(tx, config, viewer.id);
    });
    await deleteExpiredSessions(sql, config);
  } catch (error) {
    log({ event: "auth.sign_in", outcome: "failed", error: errorText(error), user: viewer.id });
    return refuse("failed");
  }
  log({ event: "auth.sign_in", outcome: "accepted", user: viewer.id });
  return redirect(absolute(env, attempt.next), 302, [
    clearState,
    sessionCookie(env.PUBLIC_URL, sessionId),
  ]);
}

/** POST /auth/sign-out: end the session, clear the cookie, go home. */
export async function handleSignOut(request: Request, deps: AuthDeps): Promise<Response> {
  const { env } = deps;
  // SameSite=Lax already keeps the cookie off cross-site POSTs; refuse them outright too.
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(env.PUBLIC_URL).origin) {
    return new Response("Cross-origin sign-out refused\n", {
      status: 403,
      headers: { ...noStore, "content-type": "text/plain; charset=utf-8" },
    });
  }
  const cookies = parseCookies(request.headers.get("cookie"));
  await deleteSession(
    deps.sql,
    { secret: env.SESSION_SECRET, now: deps.now },
    cookies.get(sessionCookieName(env.PUBLIC_URL)),
  );
  (deps.log ?? defaultLog)({ event: "auth.sign_out" });
  return redirect(absolute(env, "/"), 303, [clearSessionCookie(env.PUBLIC_URL)]);
}

/** An error's class and message. Messages from the auth and Linear modules carry no secret. */
function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}
