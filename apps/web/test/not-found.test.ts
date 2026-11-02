import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { site } from "../src/site.ts";

let html: string;
let status: number;
let contentType: string | null;

beforeAll(async () => {
  const entry = await import(pathToFileURL(join(inject("dist"), "server", "server.js")).href);
  const response: Response = await entry.default.fetch(
    new Request("http://localhost/no/such/page"),
  );
  status = response.status;
  contentType = response.headers.get("content-type");
  html = await response.text();
});

const withoutScripts = () => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

describe("not-found page", () => {
  it("SEED-R29 an unknown path returns 404 rendered on the server", () => {
    expect(status).toBe(404);
    expect(contentType).toMatch(/text\/html/);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
  });

  it("SEED-R29 keeps the site name and footer and links back to /", () => {
    const page = withoutScripts();
    expect(page).toContain(site.name);
    expect(page).toMatch(/<h1[^>]*>Page not found<\/h1>/);
    expect(page).toMatch(/<a [^>]*href="\/"[^>]*>/);
    expect(page).toContain(`href="${site.repository}"`);
    expect(page).toContain(`data-testid="version">${inject("builtVersion")}<`);
    expect(page).toContain(`data-testid="commit">${inject("builtCommit").slice(0, 7)}<`);
  });
});

describe("not-found title", () => {
  it("CONTENT-R7 an unknown path has a title of its own", () => {
    expect(html).toContain(`<title>Page not found · ${site.name}</title>`);
  });
});
