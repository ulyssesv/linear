// Per-user Linear tokens: encrypted at rest, refreshed server-side with the rotated refresh
// token persisted under a row lock (MIRROR-R17).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTokenCipher, TokenDecryptionError } from "../src/server/auth/token-cipher.ts";
import {
  getUserLinearToken,
  LinearReauthRequiredError,
  refreshMarginMs,
  storeUserTokens,
} from "../src/server/auth/user-tokens.ts";
import type { Sql } from "../src/server/db/client.ts";
import { linearTokenUrl } from "../src/server/linear/token.ts";
import { fakeLinear, migratedDatabase } from "./auth-fakes.ts";
import { json, manualClock } from "./linear-fakes.ts";

const key = Buffer.alloc(32, 7).toString("base64");
const otherKey = Buffer.alloc(32, 8).toString("base64");
const client = { LINEAR_CLIENT_ID: "test-client-id", LINEAR_CLIENT_SECRET: "test-client-secret" };
const hour = 60 * 60 * 1000;

describe("token cipher", () => {
  const cipher = createTokenCipher(key);

  it("MIRROR-R17 round-trips a token under AES-256-GCM with a versioned format", () => {
    const value = cipher.encrypt("lin_oauth_secret", "row:1");
    expect(value).toMatch(/^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$/);
    expect(value).not.toContain("lin_oauth_secret");
    expect(cipher.decrypt(value, "row:1")).toBe("lin_oauth_secret");
  });

  it("MIRROR-R17 uses a fresh IV for every value", () => {
    const a = cipher.encrypt("same", "row:1");
    const b = cipher.encrypt("same", "row:1");
    expect(a).not.toBe(b);
    expect(a.split(":")[1]).not.toBe(b.split(":")[1]);
  });

  it("MIRROR-R17 binds the ciphertext to its row and column", () => {
    const value = cipher.encrypt("lin_oauth_secret", "auth_linear_tokens:user-a:access");
    expect(() => cipher.decrypt(value, "auth_linear_tokens:user-b:access")).toThrow(
      TokenDecryptionError,
    );
  });

  it("MIRROR-R17 refuses a tampered value, another key or an unknown version", () => {
    const value = cipher.encrypt("lin_oauth_secret", "row:1");
    const [v, iv, ct, tag] = value.split(":") as [string, string, string, string];
    const flipped = `${ct.startsWith("A") ? "B" : "A"}${ct.slice(1)}`;
    expect(() => cipher.decrypt([v, iv, flipped, tag].join(":"), "row:1")).toThrow(
      TokenDecryptionError,
    );
    expect(() => createTokenCipher(otherKey).decrypt(value, "row:1")).toThrow(TokenDecryptionError);
    expect(() => cipher.decrypt(`v2:${iv}:${ct}:${tag}`, "row:1")).toThrow(/key version/);
  });

  it("MIRROR-R17 never names the plaintext or the key in an error", () => {
    const value = cipher.encrypt("lin_oauth_secret", "row:1");
    try {
      createTokenCipher(otherKey).decrypt(value, "row:1");
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("lin_oauth_secret");
      expect(String(error)).not.toContain(otherKey);
    }
  });
});

describe("getUserLinearToken", () => {
  const cipher = createTokenCipher(key);
  let db: Awaited<ReturnType<typeof migratedDatabase>>;
  let sql: Sql;

  beforeAll(async () => {
    db = await migratedDatabase("tokens");
    sql = db.sql;
  });

  afterAll(async () => {
    await db?.drop();
  });

  beforeEach(async () => {
    await sql`delete from auth_users`;
    await sql`
      insert into auth_users (id, organization_id, name, email, last_sign_in_at)
      values ('user-ada', 'org', 'Ada', 'ada@example.com', now())
    `;
  });

  async function stored(clock: { now(): number }, expiresInMs = 24 * hour) {
    await storeUserTokens(
      sql,
      cipher,
      "user-ada",
      {
        accessToken: "lin_oauth_access_0_secretvalue",
        refreshToken: "lin_oauth_refresh_0_secretvalue",
        expiresAt: clock.now() + expiresInMs,
        scope: "read write",
      },
      clock.now(),
    );
  }

  const row = async () => (await sql`select * from auth_linear_tokens`)[0];

  it("MIRROR-R17 stores access and refresh tokens encrypted, never in plaintext", async () => {
    const clock = manualClock();
    await stored(clock);
    const stored_ = await row();
    expect(JSON.stringify(stored_)).not.toMatch(/lin_oauth/);
    expect(stored_?.access_token).toMatch(/^v1:/);
    expect(stored_?.refresh_token).toMatch(/^v1:/);
  });

  it("MIRROR-R17 returns the stored token while it is fresh, without calling Linear", async () => {
    const clock = manualClock();
    await stored(clock);
    const linear = fakeLinear();
    const options = { sql, cipher, client, fetch: linear.fetch, now: clock.now };
    clock.advance(24 * hour - refreshMarginMs - 1);
    expect(await getUserLinearToken(options, "user-ada")).toBe("lin_oauth_access_0_secretvalue");
    expect(linear.calls).toHaveLength(0);
  });

  it("MIRROR-R17 refreshes server-side near expiry and persists the rotated refresh token", async () => {
    const clock = manualClock();
    await stored(clock);
    const linear = fakeLinear();
    const options = { sql, cipher, client, fetch: linear.fetch, now: clock.now };

    clock.advance(24 * hour - refreshMarginMs);
    expect(await getUserLinearToken(options, "user-ada")).toBe("lin_oauth_access_1_secretvalue");
    const [first] = linear.callsTo(linearTokenUrl);
    expect(Object.fromEntries(first?.params ?? [])).toEqual({
      grant_type: "refresh_token",
      refresh_token: "lin_oauth_refresh_0_secretvalue",
      client_id: "test-client-id",
      client_secret: "test-client-secret",
    });
    expect(JSON.stringify(await row())).not.toMatch(/lin_oauth/);

    // The next refresh spends the rotated token, not the original one.
    clock.advance(24 * hour);
    expect(await getUserLinearToken(options, "user-ada")).toBe("lin_oauth_access_2_secretvalue");
    expect(linear.callsTo(linearTokenUrl)[1]?.params?.get("refresh_token")).toBe(
      "lin_oauth_refresh_1_secretvalue",
    );
  });

  it("MIRROR-R17 concurrent callers refresh once and all get the new token", async () => {
    const clock = manualClock();
    await stored(clock);
    let refreshes = 0;
    const linear = fakeLinear({
      token: async () => {
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return json({
          access_token: `lin_oauth_access_c${refreshes}`,
          refresh_token: `lin_oauth_refresh_c${refreshes}`,
          expires_in: 86_399,
        });
      },
    });
    const options = { sql, cipher, client, fetch: linear.fetch, now: clock.now };
    clock.advance(24 * hour);
    const tokens = await Promise.all(
      Array.from({ length: 4 }, () => getUserLinearToken(options, "user-ada")),
    );
    expect(refreshes).toBe(1);
    expect(new Set(tokens)).toEqual(new Set(["lin_oauth_access_c1"]));
    const refresh = (await row())?.refresh_token as string;
    expect(cipher.decrypt(refresh, "auth_linear_tokens:user-ada:refresh")).toBe(
      "lin_oauth_refresh_c1",
    );
  });

  it("MIRROR-R17 keeps the old refresh token when the refresh fails in transit", async () => {
    const clock = manualClock();
    await stored(clock);
    const before = await row();
    const linear = fakeLinear({
      token: () => {
        throw new TypeError("fetch failed");
      },
    });
    const options = { sql, cipher, client, fetch: linear.fetch, now: clock.now };
    clock.advance(24 * hour);
    await expect(getUserLinearToken(options, "user-ada")).rejects.toThrow(/token refresh failed/);
    expect(await row()).toEqual(before);
  });

  it("MIRROR-R17 asks for a new sign-in when Linear rejects the grant, and forgets it", async () => {
    const clock = manualClock();
    await stored(clock);
    const linear = fakeLinear({
      token: () => json({ error: "invalid_grant" }, { status: 400 }),
    });
    const options = { sql, cipher, client, fetch: linear.fetch, now: clock.now };
    clock.advance(24 * hour);
    await expect(getUserLinearToken(options, "user-ada")).rejects.toThrow(
      LinearReauthRequiredError,
    );
    expect(await row()).toBeUndefined();
    await expect(getUserLinearToken(options, "user-ada")).rejects.toThrow(
      LinearReauthRequiredError,
    );
  });

  it("MIRROR-R17 refresh errors carry neither the tokens nor the client secret", async () => {
    const clock = manualClock();
    await stored(clock);
    const linear = fakeLinear({
      token: (params) =>
        json(
          { error: "server_error", error_description: `echo ${params.toString()}` },
          { status: 500 },
        ),
    });
    const options = { sql, cipher, client, fetch: linear.fetch, now: clock.now };
    clock.advance(24 * hour);
    const error = await getUserLinearToken(options, "user-ada").catch((e: unknown) => e);
    expect(String(error)).toMatch(/HTTP 500 server_error/);
    expect(String(error)).not.toMatch(/lin_oauth|test-client-secret/);
  });
});
