// The central identity (MIRROR-R2, REC-005): a client-credentials token of the Linear OAuth
// app, an `app` actor that Linear scopes to public teams. No personal API key is used at
// runtime. https://linear.app/developers/oauth-2-0-authentication
//
// The token lives 30 days. It is cached until an hour (or half its lifetime, if shorter)
// before expiry, renewed on demand after an authentication failure (rotating the client
// secret or changing scopes revokes every app token), and requested once for all
// concurrent callers. Linear allows 1000 active app tokens per app; a process that starts
// often (the scheduler CronJob) should pass a `store` so runs reuse one token instead of
// minting a new one per run.
//
// Neither the client secret nor a token ever appears in an error message.

export const linearTokenUrl = "https://api.linear.app/oauth/token";

/** Requested on every token. Never change one without the other: a different scope set
 * revokes the app's existing tokens. `write` is unused in P1 and avoids re-consent in P2. */
export const linearAppScopes = ["read", "write"] as const;

export type AppToken = {
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
};

/** Optional persistence shared by processes, e.g. an encrypted row in the database. */
export type AppTokenStore = {
  load(): Promise<AppToken | undefined>;
  save(token: AppToken): Promise<void>;
};

export type AppTokenProvider = {
  /** A valid token, from cache when fresh. */
  getToken(): Promise<string>;
  /** Drops `token` after Linear rejected it, so the next getToken() requests a new one.
   * A stale call naming an older token leaves a newer cached token alone. */
  invalidate(token: string): void;
};

export type AppTokenProviderOptions = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  /** Renew this long before expiry; capped at half the token's lifetime. Default one hour. */
  refreshMarginMs?: number;
  store?: AppTokenStore;
};

export class LinearTokenError extends Error {
  override name = "LinearTokenError";
}

const hour = 60 * 60 * 1000;

export function createAppTokenProvider(options: AppTokenProviderOptions): AppTokenProvider {
  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const marginMs = options.refreshMarginMs ?? hour;
  const basic = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64");
  const redact = (text: string) =>
    text.replaceAll(options.clientSecret, "[redacted]").replaceAll(basic, "[redacted]");

  let cached: { token: AppToken; freshUntil: number } | undefined;
  let inflight: Promise<string> | undefined;
  const rejected = new Set<string>();

  function remember(token: AppToken, obtainedAt: number) {
    const lifetime = token.expiresAt - obtainedAt;
    const freshUntil = token.expiresAt - Math.min(marginMs, Math.max(lifetime, 0) / 2);
    cached = { token, freshUntil };
    return freshUntil;
  }

  async function request(): Promise<AppToken> {
    const fail = (detail: string) =>
      new LinearTokenError(redact(`Linear token request failed: ${detail}`));
    let response: Response;
    try {
      response = await fetch(linearTokenUrl, {
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: linearAppScopes.join(","),
        }).toString(),
      });
    } catch (error) {
      throw fail(error instanceof Error ? error.message : "network error");
    }
    const body = (await response.json().catch(() => undefined)) as
      | Record<string, unknown>
      | undefined;
    if (!response.ok) {
      const code = typeof body?.error === "string" ? ` ${body.error}` : "";
      const description =
        typeof body?.error_description === "string" ? `: ${body.error_description}` : "";
      throw fail(`HTTP ${response.status}${code}${description}`.slice(0, 500));
    }
    const accessToken = body?.access_token;
    const expiresIn = body?.expires_in;
    if (typeof accessToken !== "string" || accessToken === "") {
      throw fail("response has no access_token");
    }
    if (typeof expiresIn !== "number" || !(expiresIn > 0)) {
      throw fail("response has no expires_in");
    }
    return { accessToken, expiresAt: now() + expiresIn * 1000 };
  }

  async function acquire(): Promise<string> {
    const stored = await options.store?.load();
    if (stored && !rejected.has(stored.accessToken)) {
      const at = now();
      if (remember(stored, at) > at) return stored.accessToken;
      cached = undefined;
    }
    const token = await request();
    remember(token, now());
    await options.store?.save(token);
    return token.accessToken;
  }

  return {
    getToken() {
      if (cached && now() < cached.freshUntil) return Promise.resolve(cached.token.accessToken);
      inflight ??= acquire().finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
    invalidate(token) {
      rejected.add(token);
      if (cached?.token.accessToken === token) cached = undefined;
    },
  };
}
