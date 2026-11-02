import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createAppLinearClient,
  createLinearClient,
  LinearAuthError,
  LinearGraphQLError,
  LinearHttpError,
  LinearRateLimitError,
  linearGraphqlUrl,
  rateLimitDelay,
} from "../src/server/linear/client.ts";
import {
  type AppTokenProvider,
  createAppTokenProvider,
  linearTokenUrl,
} from "../src/server/linear/token.ts";
import { json, manualClock, scriptedFetch, tokenResponse } from "./linear-fakes.ts";

const ok = (data: unknown, headers: Record<string, string> = {}) => json({ data }, { headers });
const rateLimited = (status: number, headers: Record<string, string> = {}) =>
  json(
    { errors: [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED" } }] },
    { status, headers },
  );

function fixedTokens(...tokens: string[]) {
  const issued: string[] = [];
  const invalidated: string[] = [];
  let current = 0;
  const provider: AppTokenProvider = {
    async getToken() {
      const token = tokens[Math.min(current, tokens.length - 1)] as string;
      issued.push(token);
      return token;
    },
    invalidate(token) {
      invalidated.push(token);
      if (tokens[current] === token) current++;
    },
  };
  return { provider, issued, invalidated };
}

function client(fetch: typeof globalThis.fetch, extra: Record<string, unknown> = {}) {
  const clock = manualClock();
  const tokens = fixedTokens("token-1", "token-2");
  const linear = createLinearClient({
    tokens: tokens.provider,
    fetch,
    now: clock.now,
    sleep: clock.sleep,
    ...extra,
  });
  return { linear, clock, tokens };
}

describe("Linear GraphQL client", () => {
  it("MIRROR-R2 posts the query with the app token as a bearer token", async () => {
    const { fetch, calls } = scriptedFetch(ok({ viewer: { id: "app" } }));
    const { linear } = client(fetch);
    const data = await linear.request<{ viewer: { id: string } }>(
      "query Q($n: Int) { viewer { id } }",
      { n: 1 },
    );
    expect(data).toEqual({ viewer: { id: "app" } });
    expect(calls[0]?.url).toBe(linearGraphqlUrl);
    expect(linearGraphqlUrl).toBe("https://api.linear.app/graphql");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer token-1");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      query: "query Q($n: Int) { viewer { id } }",
      variables: { n: 1 },
    });
  });

  it("MIRROR-R2 renews the token and retries once on HTTP 401", async () => {
    const { fetch, calls } = scriptedFetch(
      json({ errors: [{ message: "Authentication required" }] }, { status: 401 }),
      ok({ viewer: { id: "app" } }),
    );
    const { linear, tokens } = client(fetch);
    expect(await linear.request("{ viewer { id } }")).toEqual({ viewer: { id: "app" } });
    expect(tokens.invalidated).toEqual(["token-1"]);
    expect(new Headers(calls[1]?.init.headers).get("authorization")).toBe("Bearer token-2");
  });

  it("MIRROR-R2 renews the token on an AUTHENTICATION_ERROR GraphQL error", async () => {
    const { fetch } = scriptedFetch(
      json(
        {
          errors: [
            { message: "Authentication failed", extensions: { code: "AUTHENTICATION_ERROR" } },
          ],
        },
        { status: 400 },
      ),
      ok({ viewer: { id: "app" } }),
    );
    const { linear, tokens } = client(fetch);
    expect(await linear.request("{ viewer { id } }")).toEqual({ viewer: { id: "app" } });
    expect(tokens.invalidated).toEqual(["token-1"]);
  });

  it("MIRROR-R2 gives up after one renewal when Linear still refuses the token", async () => {
    const { fetch, calls } = scriptedFetch(json({}, { status: 401 }), json({}, { status: 401 }));
    const { linear } = client(fetch);
    const error = await linear.request("{ viewer { id } }").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LinearAuthError);
    expect(String(error)).not.toMatch(/token-\d/);
    expect(calls).toHaveLength(2);
  });

  it("MIRROR-R2 end to end with the token provider: a revoked token is replaced, not reused", async () => {
    const clock = manualClock();
    const { fetch, calls } = scriptedFetch(
      tokenResponse("old"),
      json({}, { status: 401 }),
      tokenResponse("new"),
      ok({ ok: 1 }),
      ok({ ok: 2 }),
    );
    const tokens = createAppTokenProvider({
      clientId: "id",
      clientSecret: "secret",
      fetch,
      now: clock.now,
    });
    const linear = createLinearClient({ tokens, fetch, now: clock.now, sleep: clock.sleep });
    expect(await linear.request("{ a }")).toEqual({ ok: 1 });
    expect(await linear.request("{ b }")).toEqual({ ok: 2 });
    const bearer = calls.map((c) => new Headers(c.init.headers).get("authorization"));
    expect(bearer).toEqual([
      expect.stringMatching(/^Basic /),
      "Bearer old",
      expect.stringMatching(/^Basic /),
      "Bearer new",
      "Bearer new",
    ]);
  });

  it("MIRROR-R2 the server's client authenticates with the app's client credentials only", async () => {
    const clock = manualClock();
    const { fetch, calls } = scriptedFetch(tokenResponse("app-token"), ok({ ok: true }));
    const env = {
      LINEAR_CLIENT_ID: "client-id",
      LINEAR_CLIENT_SECRET: "client-secret",
      LINEAR_API_KEY: "lin_api_personal",
    };
    const linear = createAppLinearClient(env, { fetch, now: clock.now, sleep: clock.sleep });
    await linear.request("{ ok }");
    expect(calls.map((c) => c.url)).toEqual([linearTokenUrl, linearGraphqlUrl]);
    expect(new Headers(calls[1]?.init.headers).get("authorization")).toBe("Bearer app-token");
    expect(JSON.stringify(calls)).not.toContain("lin_api_personal");
  });

  it("MIRROR-R2 no runtime code reads a personal API key", async () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const files = (await readdir(src, { recursive: true })).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(join(src, file), "utf8");
      expect(text, file).not.toMatch(/LINEAR_API_KEY|lin_api_/);
    }
  });

  it.each([[429], [400], [200]])(
    "MIRROR-R4 backs off on RATELIMITED with HTTP %i, waiting Retry-After seconds",
    async (status) => {
      const { fetch, calls } = scriptedFetch(
        rateLimited(status, { "retry-after": "7" }),
        ok({ viewer: { id: "app" } }),
      );
      const { linear, clock } = client(fetch);
      expect(await linear.request("{ viewer { id } }")).toEqual({ viewer: { id: "app" } });
      expect(clock.sleeps).toEqual([7000]);
      expect(calls).toHaveLength(2);
    },
  );

  it("MIRROR-R4 retries a plain HTTP 429 without a GraphQL body", async () => {
    const { fetch } = scriptedFetch(
      new Response("Too Many Requests", { status: 429, headers: { "retry-after": "2" } }),
      ok({ ok: true }),
    );
    const { linear, clock } = client(fetch);
    expect(await linear.request("{ ok }")).toEqual({ ok: true });
    expect(clock.sleeps).toEqual([2000]);
  });

  it("MIRROR-R4 without Retry-After waits until the exhausted budget resets", async () => {
    const { fetch } = scriptedFetch(
      () => {
        const now = Date.UTC(2026, 10, 2);
        return rateLimited(400, {
          "x-ratelimit-requests-remaining": "120",
          "x-ratelimit-requests-reset": String(now + 5_000),
          "x-ratelimit-complexity-remaining": "0",
          "x-ratelimit-complexity-reset": String(now + 90_000),
        });
      },
      ok({ ok: true }),
    );
    const { linear, clock } = client(fetch);
    await linear.request("{ ok }");
    expect(clock.sleeps).toEqual([90_000]);
  });

  it("MIRROR-R4 falls back to exponential back-off when the response names no wait", async () => {
    const { fetch } = scriptedFetch(
      rateLimited(429),
      rateLimited(429),
      rateLimited(429),
      ok({ ok: true }),
    );
    const { linear, clock } = client(fetch);
    await linear.request("{ ok }");
    expect(clock.sleeps).toEqual([1000, 2000, 4000]);
  });

  it("MIRROR-R4 stops after the retry limit with a rate-limit error carrying the retry time", async () => {
    const { fetch, calls } = scriptedFetch(
      rateLimited(429, { "retry-after": "1" }),
      rateLimited(429, { "retry-after": "1" }),
      rateLimited(429, { "retry-after": "3" }),
    );
    const { linear, clock } = client(fetch, { maxRateLimitRetries: 2 });
    const error = await linear.request("{ ok }").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LinearRateLimitError);
    expect((error as LinearRateLimitError).retryAt).toBe(clock.now() + 3000);
    expect(calls).toHaveLength(3);
  });

  it("MIRROR-R4 refuses to sleep longer than maxWaitMs and reports when to retry", async () => {
    const { fetch } = scriptedFetch(rateLimited(429, { "retry-after": "3600" }));
    const { linear, clock } = client(fetch, { maxWaitMs: 60_000 });
    const error = await linear.request("{ ok }").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LinearRateLimitError);
    expect((error as LinearRateLimitError).retryAt).toBe(clock.now() + 3_600_000);
    expect(clock.sleeps).toEqual([]);
  });

  it("MIRROR-R4 reports complexity and remaining budget of each response", async () => {
    const seen: unknown[] = [];
    const { fetch } = scriptedFetch(
      ok(
        { ok: true },
        {
          "x-complexity": "251",
          "x-ratelimit-requests-remaining": "4999",
          "x-ratelimit-complexity-remaining": "1999749",
        },
      ),
    );
    const { linear } = client(fetch, { onResponse: (info: unknown) => seen.push(info) });
    await linear.request("{ ok }");
    expect(seen).toEqual([
      expect.objectContaining({
        status: 200,
        complexity: 251,
        requestsRemaining: 4999,
        complexityRemaining: 1_999_749,
      }),
    ]);
  });

  it("throws GraphQL errors with Linear's messages", async () => {
    const { fetch } = scriptedFetch(
      json({ errors: [{ message: "Entity not found", extensions: { code: "INVALID_INPUT" } }] }),
    );
    const { linear } = client(fetch);
    const error = await linear.request("{ x }").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LinearGraphQLError);
    expect(String(error)).toMatch(/Entity not found/);
    expect((error as LinearGraphQLError).codes).toEqual(["INVALID_INPUT"]);
  });

  it("throws an HTTP error for other failures without retrying", async () => {
    const { fetch, calls } = scriptedFetch(new Response("bad gateway", { status: 502 }));
    const { linear } = client(fetch);
    const error = await linear.request("{ x }").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LinearHttpError);
    expect((error as LinearHttpError).status).toBe(502);
    expect(calls).toHaveLength(1);
  });
});

describe("rate-limit delay", () => {
  const now = Date.UTC(2026, 10, 2);

  it("MIRROR-R4 reads Retry-After as seconds or as an HTTP date", () => {
    expect(rateLimitDelay(new Headers({ "retry-after": "12" }), now, 0)).toBe(12_000);
    const date = new Date(now + 30_000).toUTCString();
    expect(rateLimitDelay(new Headers({ "retry-after": date }), now, 0)).toBe(30_000);
  });

  it("MIRROR-R4 takes the latest reset among exhausted budgets", () => {
    const headers = new Headers({
      "x-ratelimit-requests-remaining": "0",
      "x-ratelimit-requests-reset": String(now + 10_000),
      "x-ratelimit-endpoint-requests-remaining": "0",
      "x-ratelimit-endpoint-requests-reset": String(now + 20_000),
      "x-ratelimit-complexity-remaining": "500",
      "x-ratelimit-complexity-reset": String(now + 60_000),
    });
    expect(rateLimitDelay(headers, now, 0)).toBe(20_000);
  });

  it("MIRROR-R4 never returns a negative wait and caps the fallback at a minute", () => {
    const past = new Headers({
      "x-ratelimit-requests-remaining": "0",
      "x-ratelimit-requests-reset": String(now - 5_000),
    });
    expect(rateLimitDelay(past, now, 0)).toBe(0);
    expect(rateLimitDelay(new Headers(), now, 10)).toBe(60_000);
  });
});
