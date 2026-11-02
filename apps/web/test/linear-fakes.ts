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
