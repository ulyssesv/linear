// A thin GraphQL client for Linear (MIRROR-R2, MIRROR-R4), built on fetch rather than
// @linear/sdk: the sync code writes its own queries so their complexity is known and
// bounded (see budget.ts), and the SDK's lazy model fetching would hide request counts.
//
// - Authenticates with the app token from token.ts. On HTTP 401 or an AUTHENTICATION_ERROR
//   it drops that token and retries once with a fresh one.
// - Backs off on rate limiting, which Linear signals with a RATELIMITED GraphQL error code
//   (HTTP 429, and historically 400) and headers: Retry-After in seconds, else the reset
//   time (epoch ms) of whichever hourly budget is exhausted, else exponential back-off.
//   It never sleeps longer than maxWaitMs; past that, or after maxRateLimitRetries, it
//   throws LinearRateLimitError with the time to retry so a job fails loudly instead of
//   hanging. https://linear.app/developers/rate-limiting
// - Any other HTTP or GraphQL error is thrown, not retried. Errors never carry the token.

import { type AppTokenProvider, type AppTokenStore, createAppTokenProvider } from "./token.ts";

export const linearGraphqlUrl = "https://api.linear.app/graphql";

export type LinearResponseInfo = {
  status: number;
  /** Complexity Linear charged for the query (X-Complexity). */
  complexity?: number;
  requestsRemaining?: number;
  complexityRemaining?: number;
};

export type LinearClientOptions = {
  tokens: AppTokenProvider;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Rate-limited retries per request before giving up. Default 5. */
  maxRateLimitRetries?: number;
  /** Longest single wait the client accepts. Default 15 minutes. */
  maxWaitMs?: number;
  /** Called for every GraphQL response, for logging and budget accounting. */
  onResponse?: (info: LinearResponseInfo) => void;
};

export type LinearClient = {
  request<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
};

type GraphQLError = { message?: unknown; extensions?: { code?: unknown } };
type GraphQLBody = { data?: unknown; errors?: GraphQLError[] };

export class LinearHttpError extends Error {
  override name = "LinearHttpError";
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class LinearAuthError extends LinearHttpError {
  override name = "LinearAuthError";
}

export class LinearRateLimitError extends Error {
  override name = "LinearRateLimitError";
  /** Epoch milliseconds after which a retry is expected to succeed. */
  readonly retryAt: number;
  constructor(retryAt: number, message: string) {
    super(message);
    this.retryAt = retryAt;
  }
}

export class LinearGraphQLError extends Error {
  override name = "LinearGraphQLError";
  readonly codes: string[];
  constructor(codes: string[], message: string) {
    super(message);
    this.codes = codes;
  }
}

const second = 1000;
const fallbackBaseMs = second;
const fallbackCapMs = 60 * second;

function numberHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Linear documents the reset headers as epoch milliseconds; accept epoch seconds too. */
function epochMs(value: number): number {
  return value < 1e11 ? value * second : value;
}

const budgets = ["requests", "complexity", "endpoint-requests"] as const;

/**
 * How long to wait before retrying a rate-limited request: Retry-After (seconds or an
 * HTTP date), else until the latest reset among exhausted budgets, else exponential
 * back-off from one second, capped at a minute. `attempt` counts from 0.
 */
export function rateLimitDelay(headers: Headers, now: number, attempt: number): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null && retryAfter.trim() !== "") {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * second);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  const resets = budgets.flatMap((budget) => {
    const remaining = numberHeader(headers, `x-ratelimit-${budget}-remaining`);
    const reset = numberHeader(headers, `x-ratelimit-${budget}-reset`);
    return remaining !== undefined && remaining <= 0 && reset !== undefined
      ? [epochMs(reset) - now]
      : [];
  });
  if (resets.length > 0) return Math.max(0, ...resets);
  return Math.min(fallbackCapMs, fallbackBaseMs * 2 ** attempt);
}

function codes(body: GraphQLBody | undefined): string[] {
  return (body?.errors ?? []).flatMap((error) =>
    typeof error.extensions?.code === "string" ? [error.extensions.code] : [],
  );
}

function messages(body: GraphQLBody | undefined): string {
  const list = (body?.errors ?? []).flatMap((error) =>
    typeof error.message === "string" ? [error.message] : [],
  );
  return list.join("; ").slice(0, 1000);
}

export function createLinearClient(options: LinearClientOptions): LinearClient {
  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRateLimitRetries ?? 5;
  const maxWaitMs = options.maxWaitMs ?? 15 * 60 * second;

  return {
    async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      let renewed = false;
      let rateLimited = 0;
      for (;;) {
        const token = await options.tokens.getToken();
        const response = await fetch(linearGraphqlUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(variables ? { query, variables } : { query }),
        });
        const body = (await response.json().catch(() => undefined)) as GraphQLBody | undefined;
        const errorCodes = codes(body);
        options.onResponse?.({
          status: response.status,
          complexity: numberHeader(response.headers, "x-complexity"),
          requestsRemaining: numberHeader(response.headers, "x-ratelimit-requests-remaining"),
          complexityRemaining: numberHeader(response.headers, "x-ratelimit-complexity-remaining"),
        });

        if (response.status === 401 || errorCodes.includes("AUTHENTICATION_ERROR")) {
          options.tokens.invalidate(token);
          if (renewed) {
            throw new LinearAuthError(
              response.status,
              `Linear rejected a freshly issued app token (HTTP ${response.status})`,
            );
          }
          renewed = true;
          continue;
        }

        if (response.status === 429 || errorCodes.includes("RATELIMITED")) {
          const wait = rateLimitDelay(response.headers, now(), rateLimited);
          const retryAt = now() + wait;
          if (rateLimited >= maxRetries || wait > maxWaitMs) {
            throw new LinearRateLimitError(
              retryAt,
              `Linear rate limit: retry after ${new Date(retryAt).toISOString()}`,
            );
          }
          rateLimited++;
          await sleep(wait);
          continue;
        }

        if (!response.ok) {
          const detail = messages(body);
          throw new LinearHttpError(
            response.status,
            `Linear API HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
          );
        }
        if (body?.errors?.length) {
          throw new LinearGraphQLError(errorCodes, `Linear API error: ${messages(body)}`);
        }
        if (body?.data === undefined || body.data === null) {
          throw new LinearHttpError(response.status, "Linear API response has no data");
        }
        return body.data as T;
      }
    },
  };
}

/**
 * The client the server reads the workspace with: the OAuth app's client credentials from
 * the environment, and nothing else. There is deliberately no path for a personal API key.
 */
export function createAppLinearClient(
  env: { readonly LINEAR_CLIENT_ID: string; readonly LINEAR_CLIENT_SECRET: string },
  options: Omit<LinearClientOptions, "tokens"> & { tokenStore?: AppTokenStore } = {},
): LinearClient {
  const { tokenStore, ...clientOptions } = options;
  const tokens = createAppTokenProvider({
    clientId: env.LINEAR_CLIENT_ID,
    clientSecret: env.LINEAR_CLIENT_SECRET,
    fetch: options.fetch,
    now: options.now,
    store: tokenStore,
  });
  return createLinearClient({ ...clientOptions, tokens });
}
