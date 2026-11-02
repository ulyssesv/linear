// The app token persisted in Postgres, encrypted (MIRROR-R2, MIRROR-R13): the scheduler
// CronJob starts a process every few minutes and must not mint a token per run.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSql, type Sql } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { migrations } from "../src/server/db/migrations.ts";
import { createDatabaseTokenStore } from "../src/server/linear/app-token-store.ts";
import { createAppTokenProvider, linearAppScopes } from "../src/server/linear/token.ts";
import { manualClock, scriptedFetch, tokenResponse } from "./linear-fakes.ts";
import type { ScratchDatabase } from "./scratch-db.ts";
import { scratchDatabase } from "./test-db.ts";

let db: ScratchDatabase;
let sql: Sql;

beforeAll(async () => {
  db = await scratchDatabase("app_token");
  sql = createSql(db.url, { max: 2 });
  await migrate(sql, migrations);
});

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await db?.drop();
});

beforeEach(async () => {
  await sql`truncate linear_app_token`;
});

const key = Buffer.alloc(32, 3).toString("base64");
const otherKey = Buffer.alloc(32, 4).toString("base64");
const day = 24 * 60 * 60 * 1000;

describe("database app token store", () => {
  it("MIRROR-R13 round-trips a token without storing it in plain text", async () => {
    const store = createDatabaseTokenStore({ sql, clientId: "client-a", key });
    expect(await store.load()).toBeUndefined();
    const expiresAt = Date.UTC(2026, 11, 2);
    await store.save({ accessToken: "secret-app-token", expiresAt });
    expect(await store.load()).toEqual({ accessToken: "secret-app-token", expiresAt });

    const rows = await sql`select client_id, access_token from linear_app_token`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.access_token).toMatch(/^v1:/);
    expect(JSON.stringify(rows)).not.toContain("secret-app-token");

    await store.save({ accessToken: "newer-app-token", expiresAt: expiresAt + day });
    expect(await store.load()).toEqual({
      accessToken: "newer-app-token",
      expiresAt: expiresAt + day,
    });
    expect(await sql`select 1 from linear_app_token`).toHaveLength(1);
  });

  it("MIRROR-R13 a token another key or another client id wrote reads as no token", async () => {
    await createDatabaseTokenStore({ sql, clientId: "client-a", key }).save({
      accessToken: "secret-app-token",
      expiresAt: Date.UTC(2026, 11, 2),
    });
    expect(
      await createDatabaseTokenStore({ sql, clientId: "client-a", key: otherKey }).load(),
    ).toBeUndefined();
    expect(await createDatabaseTokenStore({ sql, clientId: "client-b", key }).load()).toBe(
      undefined,
    );
    // A row copied to another client id does not decrypt there either.
    await sql`
      insert into linear_app_token (client_id, access_token, expires_at)
      select 'client-b', access_token, expires_at from linear_app_token where client_id = 'client-a'
    `;
    expect(await createDatabaseTokenStore({ sql, clientId: "client-b", key }).load()).toBe(
      undefined,
    );
  });

  it("MIRROR-R2 MIRROR-R13 processes that start one after another share one app token", async () => {
    const clock = manualClock();
    const linear = scriptedFetch(tokenResponse("app-token-1"), tokenResponse("app-token-2"));
    const provider = () =>
      createAppTokenProvider({
        clientId: "client-a",
        clientSecret: "secret",
        fetch: linear.fetch,
        now: clock.now,
        store: createDatabaseTokenStore({ sql, clientId: "client-a", key }),
      });

    // Every ten minutes for a day: one token request.
    for (let run = 0; run < 144; run++) {
      expect(await provider().getToken()).toBe("app-token-1");
      clock.advance(10 * 60 * 1000);
    }
    expect(linear.calls).toHaveLength(1);

    // A token Linear rejected is replaced for every later process.
    const rejecting = provider();
    rejecting.invalidate(await rejecting.getToken());
    expect(await rejecting.getToken()).toBe("app-token-2");
    expect(await provider().getToken()).toBe("app-token-2");
    expect(linear.calls).toHaveLength(2);
  });

  it("MIRROR-R2 MIRROR-R13 a token saved under another scope set reads as no token and is replaced", async () => {
    const clock = manualClock();
    // Saved before the scopes changed, and still 30 days from expiry.
    await createDatabaseTokenStore({
      sql,
      clientId: "client-a",
      key,
      scopes: ["read", "write"],
    }).save({ accessToken: "old-scopes", expiresAt: clock.now() + 30 * day });
    const store = createDatabaseTokenStore({ sql, clientId: "client-a", key });
    expect(await store.load()).toBeUndefined();

    const linear = scriptedFetch(tokenResponse("current-scopes"));
    const tokens = createAppTokenProvider({
      clientId: "client-a",
      clientSecret: "secret",
      fetch: linear.fetch,
      now: clock.now,
      store,
    });
    expect(await tokens.getToken()).toBe("current-scopes");
    expect(new URLSearchParams(String(linear.calls[0]?.init.body)).get("scope")).toBe(
      linearAppScopes.join(","),
    );
    expect((await store.load())?.accessToken).toBe("current-scopes");
    expect(await sql`select 1 from linear_app_token`).toHaveLength(1);
  });

  it("MIRROR-R2 a stored token that expired is replaced", async () => {
    const clock = manualClock();
    const store = createDatabaseTokenStore({ sql, clientId: "client-a", key });
    await store.save({ accessToken: "old", expiresAt: clock.now() - 1 });
    const linear = scriptedFetch(tokenResponse("fresh"));
    const tokens = createAppTokenProvider({
      clientId: "client-a",
      clientSecret: "secret",
      fetch: linear.fetch,
      now: clock.now,
      store,
    });
    expect(await tokens.getToken()).toBe("fresh");
    expect((await store.load())?.accessToken).toBe("fresh");
  });
});
