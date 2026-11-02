import { describe, expect, it } from "vitest";
import {
  type AppToken,
  createAppTokenProvider,
  LinearTokenError,
  linearAppScopes,
  linearTokenUrl,
} from "../src/server/linear/token.ts";
import { json, manualClock, scriptedFetch, tokenResponse } from "./linear-fakes.ts";

const clientId = "test-client-id";
const clientSecret = "test-client-secret-hunter2";
const day = 24 * 60 * 60 * 1000;

function provider(fetch: typeof globalThis.fetch, clock = manualClock(), extra = {}) {
  return createAppTokenProvider({ clientId, clientSecret, fetch, now: clock.now, ...extra });
}

describe("client-credentials token", () => {
  it("MIRROR-R2 requests an app token with the client credentials grant and scopes read,write,initiative:read", async () => {
    const { fetch, calls } = scriptedFetch(tokenResponse("app-token-1"));
    expect(await provider(fetch).getToken()).toBe("app-token-1");

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(linearTokenUrl);
    expect(linearTokenUrl).toBe("https://api.linear.app/oauth/token");
    expect(call?.init.method).toBe("POST");
    const headers = new Headers(call?.init.headers);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(headers.get("authorization")).toBe(
      `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    );
    const body = new URLSearchParams(String(call?.init.body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "client_credentials",
      scope: "read,write,initiative:read",
    });
    // Linear refuses initiatives and initiative labels to an app actor with `read` alone.
    expect(linearAppScopes).toEqual(["read", "write", "initiative:read"]);
  });

  it("MIRROR-R2 caches the token until shortly before it expires", async () => {
    const clock = manualClock();
    const { fetch, calls } = scriptedFetch(
      tokenResponse("first", 30 * 24 * 3600),
      tokenResponse("second"),
    );
    const tokens = provider(fetch, clock);

    expect(await tokens.getToken()).toBe("first");
    clock.advance(29 * day);
    expect(await tokens.getToken()).toBe("first");
    expect(calls).toHaveLength(1);

    // Inside the refresh margin (one hour by default) before expiry: renew.
    clock.advance(day - 30 * 60 * 1000);
    expect(await tokens.getToken()).toBe("second");
    expect(calls).toHaveLength(2);
  });

  it("MIRROR-R2 requests a new token once the cached one has expired", async () => {
    const clock = manualClock();
    const { fetch } = scriptedFetch(tokenResponse("first", 3600), tokenResponse("second", 3600));
    const tokens = provider(fetch, clock);
    expect(await tokens.getToken()).toBe("first");
    clock.advance(3600 * 1000);
    expect(await tokens.getToken()).toBe("second");
  });

  it("MIRROR-R2 keeps the margin under half of a short lifetime so a token is still reused", async () => {
    const clock = manualClock();
    const { fetch, calls } = scriptedFetch(tokenResponse("short", 60));
    const tokens = provider(fetch, clock);
    expect(await tokens.getToken()).toBe("short");
    clock.advance(20 * 1000);
    expect(await tokens.getToken()).toBe("short");
    expect(calls).toHaveLength(1);
  });

  it("MIRROR-R2 shares one in-flight token request between concurrent callers", async () => {
    let release: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { fetch, calls } = scriptedFetch(() => pending);
    const tokens = provider(fetch);
    const all = Promise.all([tokens.getToken(), tokens.getToken(), tokens.getToken()]);
    release(tokenResponse("shared"));
    expect(await all).toEqual(["shared", "shared", "shared"]);
    expect(calls).toHaveLength(1);
  });

  it("MIRROR-R2 renews after invalidate() of the current token, and only once for many callers", async () => {
    const { fetch, calls } = scriptedFetch(tokenResponse("revoked"), tokenResponse("fresh"));
    const tokens = provider(fetch);
    expect(await tokens.getToken()).toBe("revoked");
    tokens.invalidate("revoked");
    tokens.invalidate("revoked");
    expect(await Promise.all([tokens.getToken(), tokens.getToken()])).toEqual(["fresh", "fresh"]);
    // A late invalidate of the old token must not throw away the fresh one.
    tokens.invalidate("revoked");
    expect(await tokens.getToken()).toBe("fresh");
    expect(calls).toHaveLength(2);
  });

  it("MIRROR-R2 retries after a failed request instead of caching the failure", async () => {
    const { fetch } = scriptedFetch(
      json({ error: "server_error" }, { status: 500 }),
      tokenResponse("ok"),
    );
    const tokens = provider(fetch);
    await expect(tokens.getToken()).rejects.toBeInstanceOf(LinearTokenError);
    expect(await tokens.getToken()).toBe("ok");
  });

  it("MIRROR-R2 rejects a response without an access token or lifetime", async () => {
    const { fetch } = scriptedFetch(json({ token_type: "Bearer" }));
    await expect(provider(fetch).getToken()).rejects.toThrow(/no access_token/);
  });

  it("MIRROR-R2 reuses a fresh token from the store and saves the tokens it obtains", async () => {
    const clock = manualClock();
    const saved: AppToken[] = [];
    let stored: AppToken | undefined = { accessToken: "stored", expiresAt: clock.now() + 10 * day };
    const store = {
      load: async () => stored,
      save: async (token: AppToken) => {
        saved.push(token);
        stored = token;
      },
    };
    const { fetch, calls } = scriptedFetch(tokenResponse("new", 3600));
    const tokens = provider(fetch, clock, { store });
    expect(await tokens.getToken()).toBe("stored");
    expect(calls).toHaveLength(0);

    tokens.invalidate("stored");
    expect(await tokens.getToken()).toBe("new");
    expect(saved).toEqual([{ accessToken: "new", expiresAt: clock.now() + 3600 * 1000 }]);
  });

  it("MIRROR-R2 does not reuse a stored token that was rejected", async () => {
    const clock = manualClock();
    const stored = { accessToken: "rejected", expiresAt: clock.now() + 10 * day };
    const store = { load: async () => stored, save: async () => {} };
    const { fetch } = scriptedFetch(tokenResponse("fresh"));
    const tokens = provider(fetch, clock, { store });
    expect(await tokens.getToken()).toBe("rejected");
    tokens.invalidate("rejected");
    expect(await tokens.getToken()).toBe("fresh");
  });

  it("MIRROR-R2 token errors never include the client secret", async () => {
    const echo = { error: "invalid_client", error_description: `bad secret ${clientSecret}` };
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const cases = [
      scriptedFetch(json(echo, { status: 401 })).fetch,
      scriptedFetch(new Response(`Basic ${basic} rejected`, { status: 400 })).fetch,
      (async () => {
        throw new Error(`connect failed for ${clientSecret}`);
      }) as typeof globalThis.fetch,
    ];
    for (const fetch of cases) {
      const error = await provider(fetch)
        .getToken()
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(error).toBeInstanceOf(LinearTokenError);
      const text = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack}`;
      expect(text).not.toContain(clientSecret);
      expect(text).not.toContain(basic);
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    }
  });

  it("MIRROR-R2 reports the status and Linear's error code when the request is refused", async () => {
    const { fetch } = scriptedFetch(
      json(
        {
          error: "Error",
          error_description: "Client does not support the client_credentials grant type",
        },
        { status: 400 },
      ),
    );
    await expect(provider(fetch).getToken()).rejects.toThrow(
      "Linear token request failed: HTTP 400 Error: Client does not support the client_credentials grant type",
    );
  });
});
