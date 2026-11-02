// Per-user Linear tokens (MIRROR-R17, REC-005): stored encrypted, refreshed server-side,
// never sent to the browser. Unused in P1; P2 pushes changes under each author's name
// with getUserLinearToken().
//
// Refresh tokens rotate, so a refresh must persist the new one or the user is signed out
// of Linear for good. The refresh runs inside a transaction holding the row lock
// (`select ... for update`): a concurrent caller waits, re-reads, finds the fresh token
// and does not spend the rotated refresh token a second time. When the HTTP call fails,
// the transaction rolls back and the old refresh token stays; Linear accepts it again for
// 30 minutes, which covers a lost response.
import type { Sql } from "../db/client.ts";
import { type OAuthClient, refreshTokens, type UserTokens } from "./linear-oauth.ts";
import type { Queryable } from "./sessions.ts";
import type { TokenCipher } from "./token-cipher.ts";

/** Refresh this long before the access token expires. */
export const refreshMarginMs = 10 * 60 * 1000;

/** The user has no usable Linear grant and must sign in again. */
export class LinearReauthRequiredError extends Error {
  override name = "LinearReauthRequiredError";
}

const aad = (userId: string, column: "access" | "refresh") =>
  `auth_linear_tokens:${userId}:${column}`;

/** Writes (or replaces) a user's tokens, encrypted. `sql` may be a transaction. */
export async function storeUserTokens(
  sql: Queryable,
  cipher: TokenCipher,
  userId: string,
  tokens: UserTokens,
  now: number,
): Promise<void> {
  const access = cipher.encrypt(tokens.accessToken, aad(userId, "access"));
  const refresh = tokens.refreshToken
    ? cipher.encrypt(tokens.refreshToken, aad(userId, "refresh"))
    : null;
  await sql`
    insert into auth_linear_tokens
      (user_id, access_token, refresh_token, access_expires_at, scope, updated_at)
    values
      (${userId}, ${access}, ${refresh}, ${new Date(tokens.expiresAt)}, ${tokens.scope},
       ${new Date(now)})
    on conflict (user_id) do update set
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      access_expires_at = excluded.access_expires_at,
      scope = excluded.scope,
      updated_at = excluded.updated_at
  `;
}

export type UserTokenOptions = {
  sql: Sql;
  cipher: TokenCipher;
  client: Omit<OAuthClient, "PUBLIC_URL">;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
};

type Row = {
  access_token: string;
  refresh_token: string | null;
  access_expires_at: Date;
};

/**
 * A valid Linear access token for `userId`, acting as that user. Refreshes it when it
 * expires within refreshMarginMs. Throws LinearReauthRequiredError when there is no grant
 * or Linear no longer accepts it; the stored tokens are then deleted.
 */
export async function getUserLinearToken(
  options: UserTokenOptions,
  userId: string,
): Promise<string> {
  const now = options.now ?? Date.now;
  const fetch = options.fetch ?? globalThis.fetch;
  const { sql, cipher } = options;
  const fresh = (row: Row) => row.access_expires_at.getTime() - refreshMarginMs > now();

  const [row] = await sql<Row[]>`
    select access_token, refresh_token, access_expires_at
    from auth_linear_tokens where user_id = ${userId}
  `;
  if (!row) throw new LinearReauthRequiredError("no Linear grant stored for this user");
  if (fresh(row)) return cipher.decrypt(row.access_token, aad(userId, "access"));

  const outcome = await sql.begin(async (tx) => {
    const [locked] = await tx<Row[]>`
      select access_token, refresh_token, access_expires_at
      from auth_linear_tokens where user_id = ${userId}
      for update
    `;
    if (!locked) return { reauth: "the stored Linear grant was removed" } as const;
    // Another request refreshed while this one waited for the lock.
    if (fresh(locked)) {
      return { token: cipher.decrypt(locked.access_token, aad(userId, "access")) } as const;
    }
    if (!locked.refresh_token) {
      await tx`delete from auth_linear_tokens where user_id = ${userId}`;
      return { reauth: "the Linear access token expired and there is no refresh token" } as const;
    }
    const refreshToken = cipher.decrypt(locked.refresh_token, aad(userId, "refresh"));
    let tokens: UserTokens;
    try {
      tokens = await refreshTokens(fetch, options.client, refreshToken, now());
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "invalid_grant") {
        await tx`delete from auth_linear_tokens where user_id = ${userId}`;
        return { reauth: "Linear no longer accepts this user's grant" } as const;
      }
      throw error;
    }
    // Linear rotates; keep the old refresh token only if it did not send a new one.
    await storeUserTokens(
      tx,
      cipher,
      userId,
      { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken },
      now(),
    );
    return { token: tokens.accessToken } as const;
  });
  if ("reauth" in outcome) throw new LinearReauthRequiredError(outcome.reauth);
  return outcome.token;
}
