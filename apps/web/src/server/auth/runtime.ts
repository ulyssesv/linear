// Wiring of the auth modules to the running server: the environment `serve` validated at
// startup, the shared database pool, and one app-organization lookup per process. Server
// only; routes reach it through server routes and the server functions in functions.ts.
import { database } from "../db/client.ts";
import { parseEnvFor } from "../env.ts";
import { type AppOrganizationLookup, createAppOrganizationLookup } from "./app-organization.ts";
import { parseCookies } from "./cookies.ts";
import { findSession, type SessionUser, sessionCookieName } from "./sessions.ts";
import type { AuthDeps } from "./sign-in.ts";
import { createTokenCipher, type TokenCipher } from "./token-cipher.ts";
import { getUserLinearToken as getToken } from "./user-tokens.ts";

export class AuthNotConfiguredError extends Error {
  override name = "AuthNotConfiguredError";
}

/** The `serve` environment. The CLI checked it before serving; `vite dev` did not. */
function serveEnv() {
  const result = parseEnvFor("serve", process.env);
  if (!result.ok) {
    // Names only: the errors never carry values.
    const names = result.errors.map((error) => error.slice(0, error.indexOf(":")));
    throw new AuthNotConfiguredError(`sign-in needs a valid ${names.join(", ")}`);
  }
  return result.env;
}

type Shared = { key: string; cipher: TokenCipher; organization: AppOrganizationLookup };
let shared: Shared | undefined;

/** Everything the sign-in handlers need, for this process's environment. */
export function authDeps(): AuthDeps {
  const env = serveEnv();
  const key = `${env.LINEAR_CLIENT_ID}\n${env.TOKEN_ENCRYPTION_KEY}`;
  if (shared?.key !== key) {
    shared = {
      key,
      cipher: createTokenCipher(env.TOKEN_ENCRYPTION_KEY),
      organization: createAppOrganizationLookup(env),
    };
  }
  return {
    env,
    sql: database(),
    cipher: shared.cipher,
    appOrganizationId: shared.organization,
  };
}

/**
 * The signed-in user of a request, or null. A request without a session cookie never
 * touches the environment or the database, so public pages work without either.
 */
export async function sessionUser(request: Request): Promise<SessionUser | null> {
  const publicUrl = process.env.PUBLIC_URL || "http://localhost:3000";
  const id = parseCookies(request.headers.get("cookie")).get(sessionCookieName(publicUrl));
  if (!id) return null;
  const { env, sql } = authDeps();
  return (await findSession(sql, { secret: env.SESSION_SECRET }, id)) ?? null;
}

/**
 * A valid Linear access token acting as `userId`, refreshed server-side when needed
 * (MIRROR-R17). For server code only; never return it to the browser. Throws
 * LinearReauthRequiredError when the user must sign in again.
 */
export function getUserLinearToken(userId: string): Promise<string> {
  const { env, sql, cipher } = authDeps();
  return getToken({ sql, cipher, client: env }, userId);
}

/** Runs a handler with the auth dependencies, or answers 503 when they are not configured. */
export async function withAuthDeps(
  handler: (deps: AuthDeps) => Response | Promise<Response>,
): Promise<Response> {
  let deps: AuthDeps;
  try {
    deps = authDeps();
  } catch (error) {
    if (!(error instanceof AuthNotConfiguredError)) throw error;
    console.error(JSON.stringify({ event: "auth.not_configured", error: error.message }));
    return new Response(`Sign-in is not configured on this server: ${error.message}\n`, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return handler(deps);
}
