// The about page and the excerpt it shares with the landing page (CONTENT-R14).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import About, { excerpt, meta } from "../content/about.mdx";
import { ContentPage } from "../src/components/content.tsx";

describe("about excerpt", () => {
  it("CONTENT-R14 about.mdx exports the excerpt as a non-empty string", () => {
    expect(typeof excerpt).toBe("string");
    expect(excerpt.trim()).not.toBe("");
  });

  it("CONTENT-R14 the about page renders the excerpt it exports", () => {
    const html = renderToStaticMarkup(<ContentPage meta={meta} Content={About} />);
    expect(html).toContain(`<p data-excerpt="true">${excerpt}</p>`);
  });
});
