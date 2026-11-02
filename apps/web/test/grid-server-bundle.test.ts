// The sheets render in the browser only (MIRROR-R23), so the server never needs the grid
// library: the adapter is reached through React.lazy from a route the server does not
// render. That is why Handsontable is a devDependency and stays out of the image's
// node_modules (`pnpm deploy --prod`, Dockerfile). This test fails when the built server
// would load the library at startup or while rendering, which would crash the container.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, inject, it } from "vitest";

const dist = inject("dist");

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return files(path);
      return /\.m?js$/.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

const lib = ["hands", "ontable"].join("");
const importsLibrary = new RegExp(
  `(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*)["'](?:@${lib}/|${lib}(?:/|["']))`,
);

describe("server bundle", () => {
  it("MIRROR-R23 reaches the grid library only through the lazily loaded adapter chunk", async () => {
    const server = [...(await files(join(dist, "server"))), join(dist, "cli.mjs")];
    const texts = await Promise.all(
      server.map(async (path) => [path, await readFile(path, "utf8")]),
    );

    const importers = texts.filter(([, text]) => importsLibrary.test(text ?? ""));
    expect(importers.map(([path]) => relative(dist, path ?? ""))).toEqual([
      expect.stringMatching(/^server\/assets\/handsontable-adapter-[\w-]+\.js$/),
    ]);

    const chunk = (importers[0]?.[0] ?? "").split("/").at(-1) ?? "";
    let lazyImporters = 0;
    for (const [path, text = ""] of texts) {
      if (path?.endsWith(chunk) || !text.includes(chunk)) continue;
      // Named only inside import(): loaded when a grid renders, which the server never does.
      const statically = new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*)["'][^"']*${chunk}`);
      expect(statically.test(text), `${relative(dist, path ?? "")} imports ${chunk}`).toBe(false);
      expect(text).toMatch(new RegExp(`import\\(\\s*["'][^"']*${chunk}["']\\s*\\)`));
      lazyImporters += 1;
    }
    expect(lazyImporters).toBeGreaterThan(0);
  });
});
