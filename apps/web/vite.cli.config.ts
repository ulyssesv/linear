// Builds src/cli.ts into dist/cli.mjs, next to the app build it serves (SEED-R24).
// Runs after `vite build`, which empties dist/.
import { defineConfig } from "vite";
import { buildInfoDefine } from "./src/server/resolve-build-info.ts";

export default defineConfig({
  define: buildInfoDefine(),
  build: {
    ssr: "src/cli.ts",
    outDir: "dist",
    emptyOutDir: false,
    target: "node26",
    rolldownOptions: { output: { entryFileNames: "cli.mjs" } },
  },
});
