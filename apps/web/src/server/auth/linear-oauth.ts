// Sign in with Linear, the user actor (MIRROR-R16, REC-005).
// https://linear.app/developers/oauth-2-0-authentication
//
// Authorization code flow with `state` and PKCE (S256), both kept in a short-lived signed
// cookie bound to the browser that started the attempt. The client secret is sent as
// well: the server is a confidential client, and PKCE protects the code in transit.
// Access tokens last about a day; refresh tokens rotate on every use.
//
// No error message carries the client secret, a code, a verifier or a token.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { linearTokenUrl } from "../linear/token.ts";
import { linearOAuthCallbackUrl } from "../linear/urls.ts";
import { isSecureOrigin, serializeCookie } from "./cookies.ts";

export const linearAuthorizeUrl = "https://linear.app/oauth/authorize";
export const linearRevokeUrl = "https://api.linear.app/oauth/revoke";

/** `write` is unused until P2 and avoids re-consent then. Not the app token's scopes:
 * Linear asks `initiative:read` of an app actor only, and a user who already consented is
 * not sent through consent again for it. */
export const linearUserScopes = ["read", "write"] as const;

export type OAuthClient = {
  LINEAR_CLIENT_ID: string;
  LINEAR_CLIENT_SECRET: string;
  PUBLIC_URL: string;
};

/** What the state cookie remembers between the redirect to Linear and the callback. */
export type SignInAttempt = { state: string; verifier: string; next: string; expiresAt: number };

export const signInAttemptMs = 10 * 60 * 1000;

export function stateCookieName(publicUrl: string): string {
  return isSecureOrigin(publicUrl) ? "__Host-linear_oauth" : "linear_oauth";
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", `oauth-state:${secret}`).update(payload).digest("base64url");
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function newSignInAttempt(next: string, now: number): SignInAttempt {
  return {
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    next,
    expiresAt: now + signInAttemptMs,
  };
}

export function encodeAttempt(secret: string, attempt: SignInAttempt): string {
  const payload = Buffer.from(JSON.stringify(attempt)).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

/** The attempt in a state cookie, if its signature holds and it has not expired. */
export function decodeAttempt(
  secret: string,
  value: string | undefined,
  now: number,
): SignInAttempt | undefined {
  if (!value) return undefined;
  const [payload, signature, ...rest] = value.split(".");
  if (!payload || !signature || rest.length > 0 || !equal(signature, sign(secret, payload))) {
    return undefined;
  }
  try {
    const attempt = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      typeof attempt?.state !== "string" ||
      typeof attempt.verifier !== "string" ||
      typeof attempt.next !== "string" ||
      typeof attempt.expiresAt !== "number" ||
      attempt.expiresAt <= now
    ) {
      return undefined;
    }
    return attempt as SignInAttempt;
  } catch {
    return undefined;
  }
}

/** Constant-time comparison of the returned state with the remembered one. */
export function stateMatches(attempt: SignInAttempt, state: string | null): boolean {
  return state !== null && equal(attempt.state, state);
}

export function stateCookie(publicUrl: string, secret: string, attempt: SignInAttempt): string {
  return serializeCookie(stateCookieName(publicUrl), encodeAttempt(secret, attempt), {
    secure: isSecureOrigin(publicUrl),
    maxAge: signInAttemptMs / 1000,
  });
}

/** The authorize URL; redirect_uri derives from PUBLIC_URL only (MIRROR-R3). */
export function authorizeUrl(env: OAuthClient, attempt: SignInAttempt): string {
  const url = new URL(linearAuthorizeUrl);
  url.search = new URLSearchParams({
    client_id: env.LINEAR_CLIENT_ID,
    redirect_uri: linearOAuthCallbackUrl(env),
    response_type: "code",
    scope: linearUserScopes.join(","),
    actor: "user",
    state: attempt.state,
    code_challenge: createHash("sha256").update(attempt.verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url.href;
}

export type UserTokens = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
};

export class LinearOAuthError extends Error {
  override name = "LinearOAuthError";
  /** The OAuth error code Linear returned, e.g. `invalid_grant`. */
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

type Fetch = typeof globalThis.fetch;

type ClientCredentials = Omit<OAuthClient, "PUBLIC_URL">;

async function tokenRequest(
  fetch: Fetch,
  env: ClientCredentials,
  what: string,
  params: Record<string, string>,
  now: number,
): Promise<UserTokens> {
  let response: Response;
  try {
    response = await fetch(linearTokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        ...params,
        client_id: env.LINEAR_CLIENT_ID,
        client_secret: env.LINEAR_CLIENT_SECRET,
      }).toString(),
    });
  } catch (error) {
    // A network error message names the host at most, never the body.
    throw new LinearOAuthError(
      `Linear ${what} failed: ${error instanceof Error ? error.name : "network error"}`,
    );
  }
  const body = (await response.json().catch(() => undefined)) as
    | Record<string, unknown>
    | undefined;
  if (!response.ok) {
    // Only the standard error code: a description could echo what was sent.
    const code = typeof body?.error === "string" ? body.error.slice(0, 64) : undefined;
    throw new LinearOAuthError(
      `Linear ${what} failed: HTTP ${response.status}${code ? ` ${code}` : ""}`,
      code,
    );
  }
  const accessToken = body?.access_token;
  const expiresIn = body?.expires_in;
  const refreshToken = body?.refresh_token;
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new LinearOAuthError(`Linear ${what} returned no access_token`);
  }
  if (typeof expiresIn !== "number" || !(expiresIn > 0)) {
    throw new LinearOAuthError(`Linear ${what} returned no expires_in`);
  }
  const scope = Array.isArray(body?.scope)
    ? body.scope.join(" ")
    : typeof body?.scope === "string"
      ? body.scope
      : "";
  return {
    accessToken,
    refreshToken:
      typeof refreshToken === "string" && refreshToken !== "" ? refreshToken : undefined,
    expiresAt: now + expiresIn * 1000,
    scope,
  };
}

/** Exchanges the callback's code, with the PKCE verifier, for the user's tokens. */
export function exchangeCode(
  fetch: Fetch,
  env: OAuthClient,
  code: string,
  verifier: string,
  now: number,
): Promise<UserTokens> {
  return tokenRequest(
    fetch,
    env,
    "code exchange",
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: linearOAuthCallbackUrl(env),
      code_verifier: verifier,
    },
    now,
  );
}

/** Trades a refresh token for a new pair; the old refresh token stops working. */
export function refreshTokens(
  fetch: Fetch,
  env: ClientCredentials,
  refreshToken: string,
  now: number,
): Promise<UserTokens> {
  return tokenRequest(
    fetch,
    env,
    "token refresh",
    { grant_type: "refresh_token", refresh_token: refreshToken },
    now,
  );
}

/** Best effort: revokes a token and swallows every failure. */
export async function revokeToken(
  fetch: Fetch,
  token: string,
  hint: "access_token" | "refresh_token",
): Promise<boolean> {
  try {
    const response = await fetch(linearRevokeUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, token_type_hint: hint }).toString(),
    });
    return response.ok;
  } catch {
    return false;
  }
}
