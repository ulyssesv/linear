// Sign in with Linear (MIRROR-R16) and what never reaches the browser or the logs
// (MIRROR-R17). The handlers run against a scratch database and a fake Linear.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { safeNext, signInErrors } from "../src/auth.ts";
import { parseCookies } from "../src/server/auth/cookies.ts";
import {
  decodeAttempt,
  linearAuthorizeUrl,
  linearRevokeUrl,
  stateCookieName,
} from "../src/server/auth/linear-oauth.ts";
import { createSession, findSession, sessionCookieName } from "../src/server/auth/sessions.ts";
import {
  type AuthDeps,
  type AuthEnv,
  decideSignIn,
  handleCallback,
  handleSignInStart,
  handleSignOut,
  type LogEntry,
} from "../src/server/auth/sign-in.ts";
import { createTokenCipher } from "../src/server/auth/token-cipher.ts";
import type { Sql } from "../src/server/db/client.ts";
import { linearGraphqlUrl } from "../src/server/linear/client.ts";
import { linearTokenUrl } from "../src/server/linear/token.ts";
import {
  appOrganization,
  type FakeLinear,
  fakeLinear,
  migratedDatabase,
  viewer,
} from "./auth-fakes.ts";
import { json, manualClock } from "./linear-fakes.ts";

const publicUrl = "https://linear.sesv.co";
const env: AuthEnv = {
  PUBLIC_URL: publicUrl,
  LINEAR_CLIENT_ID: "test-client-id",
  LINEAR_CLIENT_SECRET: "test-client-secret-value",
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
};
const cipher = createTokenCipher(Buffer.alloc(32, 3).toString("base64"));
const stateName = stateCookieName(publicUrl);
const sessionName = sessionCookieName(publicUrl);

let db: Awaited<ReturnType<typeof migratedDatabase>>;
let sql: Sql;

beforeAll(async () => {
  db = await migratedDatabase("signin");
  sql = db.sql;
});

afterAll(async () => {
  await db?.drop();
});

beforeEach(async () => {
  await sql`delete from auth_users`;
});

type Harness = {
  deps: AuthDeps;
  linear: FakeLinear;
  logs: LogEntry[];
  clock: ReturnType<typeof manualClock>;
  /** Every response the browser received, for the leak checks. */
  responses: Response[];
};

function harness(
  options: { linear?: FakeLinear; allowlist?: string[]; env?: Partial<AuthEnv> } = {},
): Harness {
  const linear = options.linear ?? fakeLinear();
  const logs: LogEntry[] = [];
  const clock = manualClock();
  return {
    linear,
    logs,
    clock,
    responses: [],
    deps: {
      env: { ...env, SIGNIN_ALLOWLIST: options.allowlist, ...options.env },
      sql,
      cipher,
      appOrganizationId: async () => appOrganization,
      fetch: linear.fetch,
      now: clock.now,
      log: (entry) => logs.push(entry),
    },
  };
}

function setCookies(response: Response): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const header of response.headers.getSetCookie()) {
    const [pair = ""] = header.split(";");
    const eq = pair.indexOf("=");
    cookies.set(pair.slice(0, eq), header);
  }
  return cookies;
}

function cookieValue(header: string | undefined): string {
  const [pair = ""] = (header ?? "").split(";");
  return decodeURIComponent(pair.slice(pair.indexOf("=") + 1));
}

/** Starts a sign-in and returns the callback request Linear would send the browser back with. */
async function start(h: Harness, next?: string) {
  const query = next === undefined ? "" : `?next=${encodeURIComponent(next)}`;
  const response = handleSignInStart(
    new Request(`http://internal:3000/auth/linear/sign-in${query}`),
    h.deps,
  );
  h.responses.push(response);
  const location = new URL(response.headers.get("location") ?? "");
  const stateCookie = setCookies(response).get(stateName);
  return { response, location, stateCookie, stateValue: cookieValue(stateCookie) };
}

async function callback(
  h: Harness,
  params: Record<string, string>,
  cookies: Record<string, string>,
): Promise<Response> {
  const response = await handleCallback(
    new Request(`http://internal:3000/auth/linear/callback?${new URLSearchParams(params)}`, {
      headers: {
        cookie: Object.entries(cookies)
          .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
          .join("; "),
      },
    }),
    h.deps,
  );
  h.responses.push(response);
  return response;
}

async function signIn(h: Harness, next?: string, extraCookies: Record<string, string> = {}) {
  const started = await start(h, next);
  const state = started.location.searchParams.get("state") ?? "";
  return callback(
    h,
    { code: "the-authorization-code", state },
    { [stateName]: started.stateValue, ...extraCookies },
  );
}

async function counts() {
  const [row] = await sql`
    select
      (select count(*) from auth_users)::int as users,
      (select count(*) from auth_linear_tokens)::int as tokens,
      (select count(*) from auth_sessions)::int as sessions
  `;
  return row;
}

/** Nothing the browser received or the server logged contains a secret (MIRROR-R17). */
async function expectNoLeaks(h: Harness, extra: string[] = []) {
  const secrets = [
    ...h.linear.issued,
    env.LINEAR_CLIENT_SECRET,
    env.SESSION_SECRET,
    "the-authorization-code",
    ...h.linear.calls.flatMap((call) => call.params?.get("code_verifier") ?? []),
    ...extra,
  ];
  const seen = [JSON.stringify(h.logs)];
  for (const response of h.responses) {
    seen.push(JSON.stringify([...response.headers]));
    seen.push(await response.clone().text());
  }
  const text = seen.join("\n");
  for (const secret of secrets)
    expect(text, "a secret reached the browser or a log").not.toContain(secret);
}

describe("sign-in start", () => {
  it("MIRROR-R16 redirects to Linear's authorize URL as the user actor, with state and PKCE", async () => {
    const h = harness();
    const { response, location, stateValue } = await start(h);
    expect(response.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe(linearAuthorizeUrl);
    const params = Object.fromEntries(location.searchParams);
    expect(params).toEqual({
      client_id: "test-client-id",
      redirect_uri: "https://linear.sesv.co/auth/linear/callback",
      response_type: "code",
      scope: "read,write",
      actor: "user",
      state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      code_challenge_method: "S256",
    });
    const attempt = decodeAttempt(env.SESSION_SECRET, stateValue, h.clock.now());
    expect(attempt?.state).toBe(params.state);
    expect(
      createHash("sha256")
        .update(attempt?.verifier ?? "")
        .digest("base64url"),
    ).toBe(params.code_challenge);
  });

  it("MIRROR-R16 binds the attempt to the browser with a short-lived HttpOnly cookie", async () => {
    const { stateCookie } = await start(harness());
    expect(stateCookie).toMatch(
      /^__Host-linear_oauth=[^;]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/,
    );
  });

  it("MIRROR-R16 the redirect URI ignores the request's host (MIRROR-R3)", async () => {
    const h = harness();
    const response = handleSignInStart(
      new Request("http://evil.example/auth/linear/sign-in", {
        headers: { host: "evil.example", "x-forwarded-host": "evil.example" },
      }),
      h.deps,
    );
    expect(response.headers.get("location")).toContain(
      encodeURIComponent("https://linear.sesv.co/auth/linear/callback"),
    );
    expect(response.headers.get("location")).not.toContain("evil");
  });
});

describe("callback", () => {
  it("MIRROR-R16 accepts a member of the app's workspace and starts a session", async () => {
    const h = harness();
    const response = await signIn(h, "/sheets/projects");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://linear.sesv.co/sheets/projects");
    const cookies = setCookies(response);
    expect(cookies.get(stateName)).toMatch(/Max-Age=0/);
    expect(cookies.get(sessionName)).toMatch(/; HttpOnly; Secure; SameSite=Lax$/);
    const user = await findSession(
      sql,
      { secret: env.SESSION_SECRET, now: h.clock.now },
      cookieValue(cookies.get(sessionName)),
    );
    expect(user).toEqual({ id: "user-ada", name: "Ada Lovelace", email: "Ada@Example.com" });
    expect(await counts()).toEqual({ users: 1, tokens: 1, sessions: 1 });
    expect(h.logs).toEqual([{ event: "auth.sign_in", outcome: "accepted", user: "user-ada" }]);
    await expectNoLeaks(h);
  });

  it("MIRROR-R16 exchanges the code with the PKCE verifier and the PUBLIC_URL redirect URI", async () => {
    const h = harness();
    await signIn(h);
    const [exchange] = h.linear.callsTo(linearTokenUrl);
    expect(Object.fromEntries(exchange?.params ?? [])).toEqual({
      grant_type: "authorization_code",
      code: "the-authorization-code",
      redirect_uri: "https://linear.sesv.co/auth/linear/callback",
      code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      client_id: "test-client-id",
      client_secret: "test-client-secret-value",
    });
    const [graphql] = h.linear.callsTo(linearGraphqlUrl);
    expect(new Headers(graphql?.init.headers).get("authorization")).toBe(
      "Bearer lin_oauth_access_1_secretvalue",
    );
  });

  it("MIRROR-R16 refuses a user of another workspace: message, no session, nothing stored, tokens revoked", async () => {
    const h = harness({
      linear: fakeLinear({ viewer: viewer({ organization: { id: "org-elsewhere" } }) }),
    });
    const response = await signIn(h);
    expect(response.headers.get("location")).toBe(
      "https://linear.sesv.co/sign-in?error=not-in-workspace",
    );
    expect(setCookies(response).has(sessionName)).toBe(false);
    expect(await counts()).toEqual({ users: 0, tokens: 0, sessions: 0 });
    const revoked = h.linear
      .callsTo(linearRevokeUrl)
      .map((call) => Object.fromEntries(call.params ?? []));
    expect(revoked).toEqual([
      { token: "lin_oauth_access_1_secretvalue", token_type_hint: "access_token" },
      { token: "lin_oauth_refresh_1_secretvalue", token_type_hint: "refresh_token" },
    ]);
    expect(h.logs).toEqual([
      { event: "auth.sign_in", outcome: "refused", reason: "not-in-workspace", user: "user-ada" },
    ]);
    expect(signInErrors["not-in-workspace"]).toMatch(/not a member of the workspace/);
    await expectNoLeaks(h);
  });

  it("MIRROR-R16 with an allowlist, refuses a workspace member whose email is not on it", async () => {
    const h = harness({ allowlist: ["grace@example.com"] });
    const response = await signIn(h);
    expect(response.headers.get("location")).toMatch(/\/sign-in\?error=not-allowed$/);
    expect(setCookies(response).has(sessionName)).toBe(false);
    expect(await counts()).toEqual({ users: 0, tokens: 0, sessions: 0 });
    await expectNoLeaks(h);
  });

  it("MIRROR-R16 with an allowlist, accepts a listed email whatever its case", async () => {
    const h = harness({ allowlist: ["grace@example.com", "ada@example.com"] });
    const response = await signIn(h);
    expect(response.headers.get("location")).toBe("https://linear.sesv.co/sheets");
    expect(setCookies(response).has(sessionName)).toBe(true);
  });

  it("MIRROR-R16 refuses a guest of the workspace", async () => {
    const h = harness({ linear: fakeLinear({ viewer: viewer({ guest: true }) }) });
    const response = await signIn(h);
    expect(response.headers.get("location")).toMatch(/error=guest$/);
    expect(await counts()).toEqual({ users: 0, tokens: 0, sessions: 0 });
  });

  it.each([
    ["no state cookie", (_value: string) => undefined, (state: string) => state],
    ["a different state", (value: string) => value, (_state: string) => "forged-state"],
    ["a tampered cookie", (value: string) => `${value.slice(0, -2)}xx`, (state: string) => state],
  ])("MIRROR-R16 refuses a callback with %s before contacting Linear", async (_, cookie, param) => {
    const h = harness();
    const started = await start(h);
    const state = started.location.searchParams.get("state") ?? "";
    const value = cookie(started.stateValue);
    const response = await callback(
      h,
      { code: "the-authorization-code", state: param(state) },
      value === undefined ? {} : { [stateName]: value },
    );
    expect(response.headers.get("location")).toMatch(/\/sign-in\?error=state$/);
    expect(setCookies(response).has(sessionName)).toBe(false);
    expect(h.linear.calls).toHaveLength(0);
  });

  it("MIRROR-R16 refuses an attempt older than ten minutes", async () => {
    const h = harness();
    const started = await start(h);
    h.clock.advance(10 * 60 * 1000);
    const response = await callback(
      h,
      { code: "c", state: started.location.searchParams.get("state") ?? "" },
      { [stateName]: started.stateValue },
    );
    expect(response.headers.get("location")).toMatch(/error=state$/);
    expect(h.linear.calls).toHaveLength(0);
  });

  it("MIRROR-R16 reports a sign-in cancelled in Linear", async () => {
    const h = harness();
    const started = await start(h);
    const response = await callback(
      h,
      { error: "access_denied", state: started.location.searchParams.get("state") ?? "" },
      { [stateName]: started.stateValue },
    );
    expect(response.headers.get("location")).toMatch(/error=denied$/);
    expect(h.linear.calls).toHaveLength(0);
  });

  it("MIRROR-R16 MIRROR-R17 a failed code exchange signs nobody in and logs no secret", async () => {
    const linear = fakeLinear({
      token: (params) =>
        json({ error: "invalid_grant", error_description: params.toString() }, { status: 400 }),
    });
    const h = harness({ linear });
    const response = await signIn(h);
    expect(response.headers.get("location")).toMatch(/error=failed$/);
    expect(await counts()).toEqual({ users: 0, tokens: 0, sessions: 0 });
    expect(h.logs).toEqual([
      {
        event: "auth.sign_in",
        outcome: "failed",
        error: "LinearOAuthError: Linear code exchange failed: HTTP 400 invalid_grant",
      },
    ]);
    await expectNoLeaks(h);
  });

  it("MIRROR-R16 refuses when the app's workspace cannot be learned, and revokes", async () => {
    const h = harness();
    h.deps.appOrganizationId = async () => {
      throw new Error("Linear API HTTP 500");
    };
    const response = await signIn(h);
    expect(response.headers.get("location")).toMatch(/error=failed$/);
    expect(await counts()).toEqual({ users: 0, tokens: 0, sessions: 0 });
    expect(h.linear.callsTo(linearRevokeUrl)).toHaveLength(2);
  });

  it("MIRROR-R17 replaces a session the browser already had", async () => {
    const h = harness();
    await sql`
      insert into auth_users (id, organization_id, name, email, last_sign_in_at)
      values ('user-old', 'org', 'Old', 'old@example.com', now())
    `;
    const config = { secret: env.SESSION_SECRET, now: h.clock.now };
    const planted = await createSession(sql, config, "user-old");
    const response = await signIn(h, undefined, { [sessionName]: planted });
    expect(await findSession(sql, config, planted)).toBeUndefined();
    expect(
      await findSession(sql, config, cookieValue(setCookies(response).get(sessionName))),
    ).toMatchObject({ id: "user-ada" });
  });

  it("MIRROR-R17 a second sign-in replaces the stored tokens, still encrypted", async () => {
    const h = harness();
    await signIn(h);
    await signIn(h);
    const rows = await sql`select * from auth_linear_tokens`;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/lin_oauth/);
    expect(cipher.decrypt(rows[0]?.access_token, "auth_linear_tokens:user-ada:access")).toBe(
      "lin_oauth_access_2_secretvalue",
    );
  });
});

describe("acceptance rule", () => {
  it("MIRROR-R16 needs the app's organization, no guest flag, and the allowlist when set", () => {
    const v = viewer();
    expect(decideSignIn(v, appOrganization, undefined)).toEqual({ ok: true });
    expect(decideSignIn(v, "other", undefined)).toEqual({ ok: false, reason: "not-in-workspace" });
    expect(decideSignIn(viewer({ guest: true }), appOrganization, undefined)).toEqual({
      ok: false,
      reason: "guest",
    });
    expect(decideSignIn(v, appOrganization, ["ada@example.com"])).toEqual({ ok: true });
    expect(decideSignIn(v, appOrganization, ["bob@example.com"])).toEqual({
      ok: false,
      reason: "not-allowed",
    });
    // The workspace check comes first: an allowlisted outsider is still refused.
    expect(decideSignIn(v, "other", ["ada@example.com"])).toEqual({
      ok: false,
      reason: "not-in-workspace",
    });
  });

  it.each([
    [undefined, "/sheets"],
    ["/sheets/projects", "/sheets/projects"],
    ["/sheets?x=1", "/sheets?x=1"],
    ["https://evil.example/sheets", "/sheets"],
    ["//evil.example/sheets", "/sheets"],
    ["/sheets//evil.example", "/sheets"],
    ["/sheets\\..\\evil", "/sheets"],
    ["/sheetsevil", "/sheets"],
    ["/", "/sheets"],
  ])("MIRROR-R16 the return path %j becomes %j", (raw, expected) => {
    expect(safeNext(raw)).toBe(expected);
  });
});

describe("sign-out", () => {
  async function signedIn() {
    const h = harness();
    const response = await signIn(h);
    return { h, id: cookieValue(setCookies(response).get(sessionName)) };
  }

  const signOut = (h: Harness, id: string, headers: Record<string, string> = {}) =>
    handleSignOut(
      new Request("http://internal:3000/auth/sign-out", {
        method: "POST",
        headers: { cookie: `${sessionName}=${id}`, ...headers },
      }),
      h.deps,
    );

  it("MIRROR-R17 ends the session and clears the cookie", async () => {
    const { h, id } = await signedIn();
    const response = await signOut(h, id, { origin: publicUrl });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://linear.sesv.co/");
    expect(setCookies(response).get(sessionName)).toMatch(/^__Host-linear_session=; .*Max-Age=0/);
    expect(await findSession(sql, { secret: env.SESSION_SECRET }, id)).toBeUndefined();
    expect(await counts()).toMatchObject({ sessions: 0 });
  });

  it("MIRROR-R17 refuses a cross-origin sign-out and keeps the session", async () => {
    const { h, id } = await signedIn();
    const response = await signOut(h, id, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(await counts()).toMatchObject({ sessions: 1 });
  });

  it("MIRROR-R17 without a session still clears the cookie", async () => {
    const h = harness();
    const response = await signOut(h, "");
    expect(response.status).toBe(303);
    expect(parseCookies(response.headers.get("set-cookie")).get(sessionName)).toBe("");
  });
});
