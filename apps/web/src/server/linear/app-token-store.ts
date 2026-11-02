// Persists the OAuth app's client-credentials token in Postgres, encrypted (MIRROR-R2,
// MIRROR-R13). Plugs into token.ts as its AppTokenStore so every process, above all the
// scheduler CronJob that starts a new process every few minutes, reuses one token for its
// 30 days instead of minting one per run against Linear's limit of 1000 active app tokens.
//
// The token is encrypted with TOKEN_ENCRYPTION_KEY and the associated data
// `app_token:<client id>:<scopes>`, so a value copied to another client id's row does not
// decrypt, and neither does a token saved under another scope set: Linear revokes the old
// tokens when the scopes change, and an old one lacks the new scope until it expires. A row
// that does not decrypt (the key or the scopes changed) reads as no token, and token.ts
// treats an expired one the same: the provider then requests a new token and saves it over
// the row.
// The plain token never reaches the database or an error message.
import type postgres from "postgres";
import { createTokenCipher, type TokenCipher } from "../auth/token-cipher.ts";
import { type AppToken, type AppTokenStore, linearAppScopes } from "./token.ts";

export type DatabaseTokenStoreOptions = {
  sql: postgres.ISql;
  clientId: string;
  /** TOKEN_ENCRYPTION_KEY, or a cipher built from it. */
  key: string | TokenCipher;
  /** The scopes the provider requests tokens with. Default `linearAppScopes`. */
  scopes?: readonly string[];
};

/** The associated data an app token is encrypted with. */
export function appTokenAssociatedData(
  clientId: string,
  scopes: readonly string[] = linearAppScopes,
): string {
  return `app_token:${clientId}:${scopes.join(",")}`;
}

export function createDatabaseTokenStore(options: DatabaseTokenStoreOptions): AppTokenStore {
  const { sql, clientId } = options;
  const cipher = typeof options.key === "string" ? createTokenCipher(options.key) : options.key;
  const associatedData = appTokenAssociatedData(clientId, options.scopes);

  return {
    async load(): Promise<AppToken | undefined> {
      const [row] = await sql`
        select access_token, expires_at from linear_app_token where client_id = ${clientId}
      `;
      if (!row) return undefined;
      let accessToken: string;
      try {
        accessToken = cipher.decrypt(String(row.access_token), associatedData);
      } catch {
        return undefined;
      }
      return { accessToken, expiresAt: new Date(row.expires_at as string | Date).getTime() };
    },
    async save(token: AppToken): Promise<void> {
      const encrypted = cipher.encrypt(token.accessToken, associatedData);
      const expiresAt = new Date(token.expiresAt);
      await sql`
        insert into linear_app_token (client_id, access_token, expires_at, updated_at)
        values (${clientId}, ${encrypted}, ${expiresAt}, now())
        on conflict (client_id) do update set
          access_token = excluded.access_token,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `;
    },
  };
}
