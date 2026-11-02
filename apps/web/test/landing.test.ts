import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { excerpt } from "../content/about.mdx";
import { meta as aiSdlc } from "../content/ai-sdlc.mdx";
import { meta as landing } from "../content/landing.mdx";
import { meta as metricsRollup } from "../content/metrics-rollup.mdx";
import { meta as planningSheet } from "../content/planning-sheet.mdx";
import { summary } from "../content/this-site.mdx";
import { initiativePages, site } from "../src/site.ts";

let html: string;
let status: number;
let contentType: string | null;

beforeAll(async () => {
  const entry = await import(pathToFileURL(join(inject("dist"), "server", "server.js")).href);
  const response: Response = await entry.default.fetch(new Request("http://localhost/"));
  status = response.status;
  contentType = response.headers.get("content-type");
  html = await response.text();
});

const withoutScripts = () => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

const pageMeta = {
  "planning-sheet": planningSheet,
  "metrics-rollup": metricsRollup,
  "ai-sdlc": aiSdlc,
} as const;

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

describe("landing route", () => {
  it("SEED-R18 is rendered on the server as a complete HTML document", () => {
    expect(status).toBe(200);
    expect(contentType).toMatch(/text\/html/);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toMatch(/<link rel="stylesheet" href="\/assets\/[^"]+\.css"/);
  });

  it("SEED-R18 CONTENT-R11 carries all of its content without JavaScript", () => {
    const page = withoutScripts();
    expect(landing.title).toBe("Cover Letter to Linear");
    expect(page).toContain(`>${landing.title}</h1>`);
    expect(page).toMatch(/<div data-purpose="true"[^>]*>\s*<p>Hello! It&#x27;s been a while/);
    expect(page).toMatch(/<h2 id="ideas"[^>]*>Ideas &amp; Experiments<\/h2>/);
    for (const initiative of initiativePages) {
      const meta = pageMeta[initiative.key];
      const card = page.slice(page.indexOf(`data-initiative="${initiative.key}"`));
      expect(card).toMatch(
        new RegExp(`^data-initiative="${initiative.key}"[^>]*><a [^>]*href="${initiative.href}"`),
      );
      expect(card).toContain(`>${escapeHtml(meta.title)}</h3>`);
      expect(card).toContain(escapeHtml(meta.description));
      expect(card).toContain(`${meta.status}</span>`);
    }
    expect(page).toContain(
      `<p data-summary="true" class="mt-3 text-muted-foreground leading-7">${escapeHtml(summary)}</p>`,
    );
    expect(page).toContain('href="/this-site"');
    expect(page).toContain('href="/about"');
  });

  it("CONTENT-R11 CONTENT-R12 a card shows the status its initiative page declares", () => {
    expect(planningSheet.status).toBe("In progress");
    expect(withoutScripts()).toMatch(
      /data-initiative="planning-sheet"[\s\S]*?Status: <\/span>In progress<\/span>/,
    );
  });

  it("CONTENT-R14 shows the author's photo and the excerpt from about.mdx", () => {
    expect(excerpt.trim()).not.toBe("");
    const about = withoutScripts().slice(withoutScripts().indexOf('data-section="about"'));
    expect(about).toContain(
      `<p data-excerpt="true" class="text-muted-foreground leading-7">${escapeHtml(excerpt)}</p>`,
    );
    expect(about).toMatch(/<img data-photo="true" src="\/assets\/me-160-[^"]+\.webp"/);
    expect(about).toContain('loading="lazy"');
  });

  it("CONTENT-R17 SEED-R21 shows the built version and short commit in the footer", () => {
    const page = withoutScripts();
    expect(page).toContain(`data-testid="version">${inject("builtVersion")}<`);
    expect(page).toContain(`data-testid="commit">${inject("builtCommit").slice(0, 7)}<`);
    expect(page).toContain(`href="${site.repository}"`);
  });
});
