import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { buildInfoDefine } from "./src/server/resolve-build-info.ts";

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  define: buildInfoDefine(),
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
