import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { proofsOfConcept, site } from "../src/site.ts";

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

describe("landing route", () => {
  it("SEED-R18 is rendered on the server as a complete HTML document", () => {
    expect(status).toBe(200);
    expect(contentType).toMatch(/text\/html/);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toMatch(/<link rel="stylesheet" href="\/assets\/[^"]+\.css"/);
  });

  it("SEED-R18 SEED-R17 carries all of its content without JavaScript", () => {
    const page = withoutScripts();
    expect(page).toContain(`<h1 class="font-semibold text-3xl tracking-tight">${site.name}</h1>`);
    expect(page).toContain(site.purpose);
    for (const poc of proofsOfConcept) {
      expect(page).toContain(`data-poc="${poc.key}"`);
      expect(page).toContain(`<h3>${poc.title}</h3>`);
      expect(page).toContain(`>${poc.status}</span>`);
      expect(page).toContain(`href="${poc.link.href}"`);
    }
    expect(page).toContain(`href="${site.repository}"`);
  });

  it("SEED-R17 SEED-R21 shows the built version and short commit in the footer", () => {
    const page = withoutScripts();
    expect(page).toContain(`data-testid="version">${inject("builtVersion")}<`);
    expect(page).toContain(`data-testid="commit">${inject("builtCommit").slice(0, 7)}<`);
  });
});
