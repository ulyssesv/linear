import mdx from "@mdx-js/rollup";
import { defineConfig } from "vitest/config";
import { buildInfoDefine } from "./src/server/resolve-build-info.ts";

// Kept apart from vite.config.ts so unit tests do not load the Start plugin.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  define: buildInfoDefine(),
  // Routes import their copy from content/*.mdx (CONTENT-R8).
  plugins: [mdx()],
  test: {
    include: ["test/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    globalSetup: ["test/global-setup.ts"],
  },
});
