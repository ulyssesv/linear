// Entrypoint of the image: `node dist/cli.mjs [serve|scheduler|migrate]` (SEED-R24).
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildInfo, shortCommit } from "./server/build-info.ts";
import { closeDatabase, createSql } from "./server/db/client.ts";
import { type MigrateResult, migrate } from "./server/db/migrate.ts";
import { migrations } from "./server/db/migrations.ts";
import { type Env, type EnvFor, parseEnvFor } from "./server/env.ts";
import { startServer } from "./server/start.ts";

export type MigrateCommand = (env: EnvFor<"migrate">) => Promise<MigrateResult>;

export type CliIo = {
  env: Readonly<Record<string, string | undefined>>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  serve: (env: Env) => Promise<void>;
  migrate: MigrateCommand;
};

const usage = "usage: cli.mjs [serve|scheduler|migrate]";

// Reserved commands exit 2 so a CronJob never reports success for work that did not happen.
const reserved: Record<string, string> = {
  scheduler: "the planning-sheet spec that introduces the scheduler",
};

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
  const owner = reserved[command];
  if (owner) {
    io.stderr(`"${command}" is reserved and not implemented yet; ${owner} will implement it.`);
    return 2;
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
  });
  if (code !== undefined) process.exitCode = code;
}
