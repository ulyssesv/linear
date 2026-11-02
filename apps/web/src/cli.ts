// Entrypoint of the image: `node dist/cli.mjs [serve|scheduler|migrate]` (SEED-R24).
// `migrate` (MIRROR-R5) and `scheduler` (MIRROR-R13) replaced the reserved exit 2 of
// SEED-R24; no command is reserved any more.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildInfo, shortCommit } from "./server/build-info.ts";
import { closeDatabase, createSql } from "./server/db/client.ts";
import { type MigrateResult, migrate } from "./server/db/migrate.ts";
import { migrations } from "./server/db/migrations.ts";
import { type Env, type EnvFor, parseEnvFor } from "./server/env.ts";
import { type SchedulerResult, schedulerPass } from "./server/mirror/scheduler.ts";
import { startServer } from "./server/start.ts";

export type MigrateCommand = (env: EnvFor<"migrate">) => Promise<MigrateResult>;
export type SchedulerCommand = (env: EnvFor<"scheduler">) => Promise<SchedulerResult>;

export type CliIo = {
  env: Readonly<Record<string, string | undefined>>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  serve: (env: Env) => Promise<void>;
  migrate: MigrateCommand;
  scheduler: SchedulerCommand;
};

const usage = "usage: cli.mjs [serve|scheduler|migrate]";

/** Runs a command. Resolves to an exit code, or to undefined while the server keeps running. */
export async function run(argv: readonly string[], io: CliIo): Promise<number | undefined> {
  const [command = "serve", ...rest] = argv;
  if (rest.length > 0) {
    io.stderr(usage);
    return 1;
  }
  // MIRROR-R7: each command validates only the names it uses and lists every problem.
  if (command === "serve") {
    const result = parseEnvFor("serve", io.env);
    if (!result.ok) return invalidEnv(result.errors, io);
    await io.serve(result.env);
    return undefined;
  }
  if (command === "migrate") {
    const result = parseEnvFor("migrate", io.env);
    if (!result.ok) return invalidEnv(result.errors, io);
    return runMigrate(result.env, io);
  }
  if (command === "scheduler") {
    const result = parseEnvFor("scheduler", io.env);
    if (!result.ok) return invalidEnv(result.errors, io);
    return runScheduler(result.env, io);
  }
  io.stderr(`unknown command "${command}"`);
  io.stderr(usage);
  return 1;
}

function invalidEnv(errors: readonly string[], io: CliIo): number {
  io.stderr("Invalid environment:");
  for (const error of errors) io.stderr(`  ${error}`);
  return 1;
}

// MIRROR-R5: exit 0 once every migration is applied, 1 on any failure; safe to run again.
async function runMigrate(env: EnvFor<"migrate">, io: CliIo): Promise<number> {
  try {
    const { applied } = await io.migrate(env);
    io.stdout(
      applied.length === 0
        ? "migrate: the database is up to date"
        : `migrate: applied ${applied.length} migration${applied.length === 1 ? "" : "s"}: ` +
            applied.join(", "),
    );
    return 0;
  } catch (error) {
    io.stderr(`migrate failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

// MIRROR-R13: one pass, exit 0 when it succeeded or another pass holds the lock, 1 on any
// failure, so the CronJob's history tells the truth. MIRROR-R31: one JSON line per pass,
// on stdout, or on stderr when it failed.
async function runScheduler(env: EnvFor<"scheduler">, io: CliIo): Promise<number> {
  let line: Record<string, unknown>;
  try {
    line = schedulerLogLine(await io.scheduler(env));
  } catch (error) {
    // The pass could not start: no database, or the lock could not be taken.
    line = {
      event: "scheduler",
      outcome: "failed",
      error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    };
  }
  if (line.outcome === "failed") {
    io.stderr(JSON.stringify(line));
    return 1;
  }
  io.stdout(JSON.stringify(line));
  return 0;
}

/** The structured log line of one pass. Carries no secret: errors are redacted upstream. */
export function schedulerLogLine(result: SchedulerResult): Record<string, unknown> {
  const { linear } = result;
  if (result.outcome === "skipped") {
    return { event: "scheduler", outcome: "skipped", reason: result.reason, linear };
  }
  const timing = {
    startedAt: result.startedAt.toISOString(),
    finishedAt: result.finishedAt.toISOString(),
    durationMs: result.finishedAt.getTime() - result.startedAt.getTime(),
  };
  if (result.outcome === "failed") {
    return {
      event: "scheduler",
      outcome: "failed",
      source: result.source,
      ...timing,
      error: result.error,
      linear,
    };
  }
  return {
    event: "scheduler",
    outcome: "ok",
    source: result.source,
    ...timing,
    since: result.since?.toISOString() ?? null,
    changed: result.changed,
    counts: result.counts,
    linear,
    prunedDeliveries: result.prunedDeliveries ?? null,
  };
}

/** Applies the migrations bundled into this build over one connection. */
async function migrateDatabase(env: EnvFor<"migrate">): Promise<MigrateResult> {
  const sql = createSql(env.DATABASE_URL, { max: 1 });
  try {
    return await migrate(sql, migrations);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Serves the production build that sits next to this file in dist/. */
async function serveBuild(env: Env): Promise<void> {
  const dist = dirname(fileURLToPath(import.meta.url));
  const entry = await import(pathToFileURL(join(dist, "server", "server.js")).href);
  const server = await startServer({
    fetch: (request) => entry.default.fetch(request),
    clientDir: join(dist, "client"),
    port: env.PORT,
    silent: true,
    gracefulShutdown: true,
  });
  // The server bundle opens the database pool on first use; close it so the process exits.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void closeDatabase());
  }
  console.log(
    `linear.sesv.co ${buildInfo.version} (${shortCommit(buildInfo.commit)}) listening on ` +
      `${server.url}, public at ${env.PUBLIC_URL}`,
  );
}

if (import.meta.main) {
  const code = await run(process.argv.slice(2), {
    env: process.env,
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    serve: serveBuild,
    migrate: migrateDatabase,
    scheduler: (env) => schedulerPass(env),
  });
  if (code !== undefined) process.exitCode = code;
}
