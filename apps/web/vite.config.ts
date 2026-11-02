import mdx from "@mdx-js/rollup";
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
    // MDX first, so the copy under content/ compiles to JSX before React sees it (CONTENT-R8).
    plugins: [
      { enforce: "pre", ...mdx() },
      tailwindcss(),
      tanstackStart(),
      viteReact({ include: /\.(?:mdx|[jt]sx?)$/ }),
    ],
  };
});
