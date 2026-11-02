// The public pages, rendered by the built server without JavaScript (CONTENT-R1 to R3,
// CONTENT-R7). The browser checks are in e2e/content.spec.ts.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { ContentModule } from "../src/lib/content.ts";
import { navigation, site } from "../src/site.ts";

const modules = import.meta.glob<ContentModule>("../content/*.mdx", { eager: true });
const contentPages = Object.entries(modules).map(([file, module]) => ({
  path: `/${file.replace("../content/", "").replace(/\.mdx$/, "")}`,
  meta: module.meta,
}));

type Fetch = (request: Request) => Promise<Response>;
let fetchPage: Fetch;

beforeAll(async () => {
  const entry = await import(pathToFileURL(join(inject("dist"), "server", "server.js")).href);
  fetchPage = (request) => entry.default.fetch(request);
});

const get = async (path: string) => {
  const response = await fetchPage(new Request(`http://localhost${path}`));
  const html = await response.text();
  return { response, html, page: html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "") };
};

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

describe("public pages", () => {
  it("CONTENT-R1 every navigation target is a content page", () => {
    expect(contentPages.map((page) => page.path).sort()).toEqual(
      navigation.map((item) => item.href).sort(),
    );
  });

  it.each(contentPages)(
    "CONTENT-R1 CONTENT-R2 $path answers 200 server-rendered for an anonymous visitor",
    async ({ path, meta }) => {
      const { response, page } = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/text\/html/);
      expect(page).toContain(`<h1>${escapeHtml(meta.title)}</h1>`);
    },
  );

  it.each(contentPages)(
    "CONTENT-R7 $path takes its title and description from its content file",
    async ({ path, meta }) => {
      const { page } = await get(path);
      expect(page.match(/<title>/g)).toHaveLength(1);
      expect(page).toContain(`<title>${escapeHtml(meta.title)} · ${site.name}</title>`);
      expect(page.match(/<meta name="description"/g)).toHaveLength(1);
      expect(page).toContain(`<meta name="description" content="${escapeHtml(meta.description)}"`);
    },
  );

  it.each(contentPages)("CONTENT-R3 $path marks itself in the navigation", async ({ path }) => {
    const { page } = await get(path);
    const current = [...page.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)].map((m) => m[0]);
    // The wide navigation and the narrow menu each mark it once.
    expect(current).toHaveLength(2);
    for (const link of current) expect(link).toContain(`href="${path}"`);
  });

  it("CONTENT-R3 CONTENT-R4 the header carries the site name and a sign-in link back here", async () => {
    const { page } = await get("/about?x=1");
    expect(page).toMatch(/<a href="\/"[^>]*>linear\.sesv\.co<\/a>/);
    expect(page).toContain('href="/sign-in?next=%2Fabout%3Fx%3D1"');
    expect(page).not.toContain('aria-current="page" href="/"');
  });
});
