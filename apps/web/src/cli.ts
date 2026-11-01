// Entrypoint of the image: `node dist/cli.mjs [serve|scheduler|migrate]` (SEED-R24).
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildInfo, shortCommit } from "./server/build-info.ts";
import { type Env, parseEnv } from "./server/env.ts";
import { startServer } from "./server/start.ts";

export type CliIo = {
  env: Readonly<Record<string, string | undefined>>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  serve: (env: Env) => Promise<void>;
};

const usage = "usage: cli.mjs [serve|scheduler|migrate]";

// Reserved commands exit 2 so a CronJob never reports success for work that did not happen.
const reserved: Record<string, string> = {
  scheduler: "the planning-sheet spec that introduces the scheduler",
  migrate: "the planning-sheet spec that introduces Postgres",
};

/** Runs a command. Resolves to an exit code, or to undefined while the server keeps running. */
export async function run(argv: readonly string[], io: CliIo): Promise<number | undefined> {
  const [command = "serve", ...rest] = argv;
  if (rest.length > 0) {
    io.stderr(usage);
    return 1;
  }
  if (command === "serve") {
    const result = parseEnv(io.env);
    if (!result.ok) {
      io.stderr("Invalid environment:");
      for (const error of result.errors) io.stderr(`  ${error}`);
      return 1;
    }
    await io.serve(result.env);
    return undefined;
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
  });
  if (code !== undefined) process.exitCode = code;
}
