// A fake Linear for the sign-in tests: token, GraphQL and revoke endpoints answered in
// process, every call recorded. No test reaches the network. Issued tokens carry a
// recognisable prefix so tests can prove none of them leaks into a response or a log.

import { linearRevokeUrl } from "../src/server/auth/linear-oauth.ts";
import type { Viewer } from "../src/server/auth/sign-in.ts";
import { createSql, type Sql } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { migrations } from "../src/server/db/migrations.ts";
import { linearGraphqlUrl } from "../src/server/linear/client.ts";
import { linearTokenUrl } from "../src/server/linear/token.ts";
import { json, type Recorded } from "./linear-fakes.ts";
import { scratchDatabase } from "./test-db.ts";

export const appOrganization = "org-app-workspace";

export function viewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    id: "user-ada",
    name: "Ada Lovelace",
    email: "Ada@Example.com",
    guest: false,
    organization: { id: appOrganization },
    ...overrides,
  };
}

type TokenAnswer = (params: URLSearchParams) => Response | Promise<Response>;

export type FakeLinear = ReturnType<typeof fakeLinear>;

export function fakeLinear(options: { viewer?: Viewer; token?: TokenAnswer } = {}) {
  const calls: (Recorded & { params?: URLSearchParams })[] = [];
  const issued: string[] = [];
  let serial = 0;
  const issue = () => {
    serial++;
    const access = `lin_oauth_access_${serial}_secretvalue`;
    const refresh = `lin_oauth_refresh_${serial}_secretvalue`;
    issued.push(access, refresh);
    return { access, refresh };
  };
  const defaultToken: TokenAnswer = () => {
    const { access, refresh } = issue();
    return json({
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: 86_399,
      scope: "read write",
    });
  };

  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const params =
      typeof init.body === "string" && url !== linearGraphqlUrl
        ? new URLSearchParams(init.body)
        : undefined;
    calls.push({ url, init, params });
    if (url === linearTokenUrl) return (options.token ?? defaultToken)(params as URLSearchParams);
    if (url === linearGraphqlUrl) return json({ data: { viewer: options.viewer ?? viewer() } });
    if (url === linearRevokeUrl) return new Response(null, { status: 200 });
    throw new Error(`unexpected request to ${url}`);
  };

  return {
    fetch: fetch as typeof globalThis.fetch,
    calls,
    /** Every token this fake has handed out. */
    issued,
    issue,
    callsTo: (url: string) => calls.filter((call) => call.url === url),
  };
}

/** A migrated scratch database of its own. */
export async function migratedDatabase(
  label: string,
): Promise<{ sql: Sql; drop(): Promise<void> }> {
  const db = await scratchDatabase(label);
  const sql = createSql(db.url, { max: 5 });
  await migrate(sql, migrations);
  return {
    sql,
    async drop() {
      await sql.end({ timeout: 5 });
      await db.drop();
    },
  };
}
