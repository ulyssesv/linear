import { defineConfig } from "vitest/config";
import { buildInfoDefine } from "./src/server/resolve-build-info.ts";

// Kept apart from vite.config.ts so unit tests do not load the Start plugin.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  define: buildInfoDefine(),
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
  },
});
