// The initiative pages' status and sections (CONTENT-R12). The browser checks, anonymous
// and signed in, are in e2e/initiatives.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContentPage } from "../src/components/content.tsx";
import { type ContentModule, initiativeStatuses, isInitiativeMeta } from "../src/lib/content.ts";
import { initiativePages } from "../src/site.ts";

const modules = import.meta.glob<ContentModule>("../content/*.mdx", { eager: true });
const moduleFor = (key: string) => {
  const module = modules[`../content/${key}.mdx`];
  if (!module) throw new Error(`no content file for ${key}`);
  return module;
};

const initiatives = [
  { key: "planning-sheet", status: "In progress", demo: "/sheets" },
  { key: "metrics-rollup", status: "Planned", demo: undefined },
  { key: "ai-sdlc", status: "Planned", demo: undefined },
] as const;

const Empty = () => <p>Body</p>;

const render = (module: ContentModule) =>
  renderToStaticMarkup(<ContentPage meta={module.meta} Content={module.default} />);

describe("initiative pages", () => {
  it("CONTENT-R12 there is one page per initiative", () => {
    expect(initiatives.map((page) => page.key).sort()).toEqual(
      initiativePages.map((page) => page.key).sort(),
    );
  });

  it.each(initiatives)("CONTENT-R12 $key is $status", ({ key, status }) => {
    const { meta } = moduleFor(key);
    expect(isInitiativeMeta(meta)).toBe(true);
    expect(meta.status).toBe(status);
  });

  it.each(initiatives)("CONTENT-R12 $key shows its status under the title", ({ key, status }) => {
    const module = moduleFor(key);
    expect(render(module)).toContain(
      `<h1>${module.meta.title}</h1><p data-initiative-status="true" class="not-prose"><span class="sr-only">Status: </span><span data-slot="badge"`,
    );
    expect(render(module)).toMatch(new RegExp(`data-slot="badge"[^>]*>${status}</span>`));
  });

  it.each(initiatives)(
    "CONTENT-R12 $key has the problem, proposal, demo and links sections",
    ({ key }) => {
      const html = render(moduleFor(key));
      const headings = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => match[1]);
      expect(headings).toEqual(["Problem", "Proposal", "Demo", "Links"]);
    },
  );

  it.each(initiatives)("CONTENT-R12 $key's demo section", ({ key, demo }) => {
    const html = render(moduleFor(key));
    if (demo) {
      expect(html).toMatch(new RegExp(`<p data-demo="link"[^>]*><a href="${demo}"`));
      expect(html).not.toContain('data-demo="none"');
    } else {
      expect(html).toContain('data-demo="none"');
      expect(html).not.toContain('data-demo="link"');
    }
  });

  it.each(initiatives)("CONTENT-R12 $key links to its Linear initiative", ({ key }) => {
    const initiative = initiativePages.find((page) => page.key === key);
    expect(render(moduleFor(key))).toContain(`href="${initiative?.linear}"`);
  });

  it("CONTENT-R12 only initiative pages carry a status", () => {
    const keys = initiatives.map((page) => page.key as string);
    for (const [path, module] of Object.entries(modules)) {
      const key = path.replace("../content/", "").replace(/\.mdx$/, "");
      if (keys.includes(key)) continue;
      expect(isInitiativeMeta(module.meta)).toBe(false);
      expect(render(module)).not.toContain("data-initiative-status");
    }
  });

  it("CONTENT-R12 a status outside Planned, In progress and Live is not shown", () => {
    expect(initiativeStatuses).toEqual(["Planned", "In progress", "Live"]);
    expect(isInitiativeMeta({ title: "T", description: "D", status: "Done" })).toBe(false);
    expect(isInitiativeMeta({ title: "T", description: "D" })).toBe(false);
    const html = renderToStaticMarkup(
      <ContentPage meta={{ title: "T", description: "D", status: "Done" }} Content={Empty} />,
    );
    expect(html).not.toContain("data-initiative-status");
  });
});
