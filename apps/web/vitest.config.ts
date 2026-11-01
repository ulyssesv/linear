import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts so unit tests do not load the Start plugin.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ["test/**/*.test.ts", "src/**/*.test.ts"] },
});
