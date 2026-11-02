// Fakes for the Linear client tests: a scripted fetch and a manual clock. No test reaches
// the network; every response comes from the script.

export type Recorded = { url: string; init: RequestInit };

type Responder = (request: Recorded) => Response | Promise<Response>;

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

/** A fetch that answers from `responders` in order, recording every call. */
export function scriptedFetch(...responders: (Response | Responder)[]) {
  const calls: Recorded[] = [];
  const queue = [...responders];
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const call = { url: String(input), init };
    calls.push(call);
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request to ${call.url}`);
    return typeof next === "function" ? next(call) : next;
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

export function manualClock(start = Date.UTC(2026, 10, 2)) {
  let now = start;
  const sleeps: number[] = [];
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    /** Records the wait and moves the clock, so tests never actually sleep. */
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

export function tokenResponse(accessToken: string, expiresIn = 2_591_999): Response {
  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    scope: "read write",
  });
}

/** What Linear answers an app token without `initiative:read` or `initiative:write` that
 * asks for initiatives or initiative labels. */
export const initiativeScopeMessage =
  "Invalid scope: `initiative:read` or `initiative:write` required for app user to read initiative data";

/**
 * Linear's scope check, for fakes that issue app tokens: `grant` remembers the scopes a
 * token request asked for, and `refuse` answers a query for `type` the way Linear does when
 * the token lacks the scope it needs, or returns undefined to let the query through.
 */
export function scopeGate() {
  const granted = new Map<string, string[]>();
  return {
    grant(accessToken: string, tokenRequest: RequestInit): void {
      const scope = new URLSearchParams(String(tokenRequest.body)).get("scope") ?? "";
      granted.set(accessToken, scope.split(","));
    },
    refuse(query: RequestInit, type: string): Response | undefined {
      if (type !== "initiatives" && type !== "initiativeLabels") return undefined;
      const bearer = new Headers(query.headers).get("authorization") ?? "";
      const scopes = granted.get(bearer.replace(/^Bearer /, "")) ?? [];
      if (scopes.includes("initiative:read") || scopes.includes("initiative:write")) {
        return undefined;
      }
      return json({ errors: [{ message: initiativeScopeMessage }] }, { status: 400 });
    },
  };
}
