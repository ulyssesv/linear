// Content files and the components they can use (CONTENT-R8, CONTENT-R9).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContentPage, contentComponents } from "../src/components/content.tsx";
import { ViewerContext } from "../src/components/viewer.tsx";
import { type ContentModule, missingMeta } from "../src/lib/content.ts";
import Fixture, { meta as fixtureMeta } from "./fixtures/components.mdx";

const contentDir = join(import.meta.dirname, "..", "content");
const modules = import.meta.glob<ContentModule>("../content/*.mdx", { eager: true });
const files = Object.entries(modules).map(([path, module]) => ({
  name: path.replace("../content/", ""),
  module,
}));

const user = { id: "u1", name: "Ada Lovelace", email: "ada@example.com" };

describe("content files", () => {
  it("CONTENT-R8 every page's copy is an MDX file under apps/web/content", () => {
    const onDisk = readdirSync(contentDir).filter((name) => !name.startsWith("."));
    expect(onDisk.length).toBeGreaterThan(0);
    expect(onDisk.every((name) => name.endsWith(".mdx"))).toBe(true);
    expect(files.map((file) => file.name).sort()).toEqual(onDisk.sort());
  });

  it.each(files)("CONTENT-R8 $name exports meta with a title and a description", ({ module }) => {
    expect(missingMeta(module.meta)).toEqual([]);
  });

  it("CONTENT-R8 a meta without a title or a description is refused", () => {
    expect(missingMeta(undefined)).toEqual(["title", "description"]);
    expect(missingMeta({ title: "Only a title" })).toEqual(["description"]);
    expect(missingMeta({ title: " ", description: "No title" })).toEqual(["title"]);
    expect(missingMeta({ title: "T", description: "D" })).toEqual([]);
  });

  it.each(files)("CONTENT-R9 $name renders with the site components alone", ({ module }) => {
    const html = renderToStaticMarkup(<ContentPage meta={module.meta} Content={module.default} />);
    expect(html).toContain(`<article class="prose"><h1>${module.meta.title}</h1>`);
  });
});

describe("site components", () => {
  it("CONTENT-R9 content can use the demo link and the callout", () => {
    expect(Object.keys(contentComponents).sort()).toEqual(["Callout", "DemoLink"]);
    const html = renderToStaticMarkup(<ContentPage meta={fixtureMeta} Content={Fixture} />);
    expect(html).toContain("data-callout");
    expect(html).toContain("Heads up");
    expect(html).toMatch(/<p data-demo="link"[^>]*><a href="\/sheets"[^>]*>Open the demo<svg/);
    expect(html).toContain('data-demo="none"');
  });

  it("CONTENT-R9 every content page shares one prose style", () => {
    for (const { module } of files) {
      const html = renderToStaticMarkup(
        <ContentPage meta={module.meta} Content={module.default} />,
      );
      expect(html.match(/class="prose"/g)).toHaveLength(1);
    }
  });

  it("CONTENT-R9 a component outside the set fails to render", () => {
    expect(() => renderToStaticMarkup(<Fixture />)).toThrow(/Expected component `\w+`/);
    expect(() =>
      renderToStaticMarkup(<Fixture components={{ Callout: contentComponents.Callout }} />),
    ).toThrow(/Expected component `DemoLink`/);
  });

  it("CONTENT-R12 the demo link asks anonymous visitors to sign in", () => {
    const anonymous = renderToStaticMarkup(<Fixture components={contentComponents} />);
    expect(anonymous).toContain("needs sign-in with a Linear account of the workspace");
    const signedIn = renderToStaticMarkup(
      <ViewerContext value={user}>
        <Fixture components={contentComponents} />
      </ViewerContext>,
    );
    expect(signedIn).not.toContain("needs sign-in");
    expect(signedIn).toContain('href="/sheets"');
  });
});
