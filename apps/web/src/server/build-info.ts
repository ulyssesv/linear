// Build info baked in by the Vite `define` from resolve-build-info.ts (SEED-R21).
import type { BuildInfo } from "./resolve-build-info.ts";

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

export const buildInfo: BuildInfo = { version: __APP_VERSION__, commit: __APP_COMMIT__ };

export function shortCommit(commit: string): string {
  return /^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 7) : commit;
}
