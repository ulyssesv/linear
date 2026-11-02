import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localDatabaseUrl } from "./src/server/db/local.ts";
import { buildInfoDefine } from "./src/server/resolve-build-info.ts";

export default defineConfig(({ command }) => {
  // The dev server talks to the compose database unless told otherwise (MIRROR-R8).
  if (command === "serve") process.env.DATABASE_URL ||= localDatabaseUrl;
  return {
    server: { port: 3000 },
    resolve: { tsconfigPaths: true },
    define: buildInfoDefine(),
    plugins: [tailwindcss(), tanstackStart(), viteReact()],
  };
});
