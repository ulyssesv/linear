// Resolves APP_VERSION and APP_COMMIT at build time (SEED-R21). Imported by the Vite configs,
// so it must not depend on anything only the bundler provides.
import { execFileSync } from "node:child_process";

export type BuildInfo = { version: string; commit: string };

type Source = { APP_VERSION?: string | undefined; APP_COMMIT?: string | undefined };

export function readGitHead(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function resolveBuildInfo(
  source: Source = process.env,
  gitHead: () => string | undefined = readGitHead,
): BuildInfo {
  return {
    version: source.APP_VERSION || "dev",
    commit: source.APP_COMMIT || gitHead() || "unknown",
  };
}

/** Vite `define` entries that bake the build info into the bundle. */
export function buildInfoDefine(source: Source = process.env): Record<string, string> {
  const info = resolveBuildInfo(source);
  return {
    __APP_VERSION__: JSON.stringify(info.version),
    __APP_COMMIT__: JSON.stringify(info.commit),
  };
}
