// The image's `scheduler` command (MIRROR-R13): one sync pass against the configured
// database and Linear, then the pool is closed so the process exits. cli.ts turns the
// result into an exit code and one structured log line (MIRROR-R31).
//
// The app token comes from the database, encrypted (app-token-store.ts), so a CronJob that
// starts a process every few minutes reuses one token for its 30 days.
import { createSql } from "../db/client.ts";
import type { EnvFor } from "../env.ts";
import { createDatabaseTokenStore } from "../linear/app-token-store.ts";
import { createAppLinearClient } from "../linear/client.ts";
import { type PassResult, runSyncPass } from "./reconcile.ts";

export type SchedulerResult = PassResult & {
  /** GraphQL requests the pass made and the complexity Linear charged for them. */
  linear: { requests: number; complexity: number };
};

export type SchedulerOptions = {
  /** For tests: Linear is never reached through anything else. */
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** Runs one pass. Throws only when the database cannot be used at all. */
export async function schedulerPass(
  env: EnvFor<"scheduler">,
  options: SchedulerOptions = {},
): Promise<SchedulerResult> {
  // One connection holds the pass's advisory lock, one runs its transaction.
  const sql = createSql(env.DATABASE_URL, { max: 3 });
  const linear = { requests: 0, complexity: 0 };
  try {
    const client = createAppLinearClient(env, {
      ...options,
      apiUrl: env.LINEAR_API_URL,
      tokenStore: createDatabaseTokenStore({
        sql,
        clientId: env.LINEAR_CLIENT_ID,
        key: env.TOKEN_ENCRYPTION_KEY,
      }),
      onResponse: (info) => {
        linear.requests++;
        linear.complexity += info.complexity ?? 0;
      },
    });
    const result = await runSyncPass({ sql, client, now: options.now });
    return { ...result, linear };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
