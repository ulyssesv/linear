// Which links the router shows in place (CONTENT-R21).
import { describe, expect, it } from "vitest";
import { isPageHref } from "../src/components/site-link.tsx";

describe("site links", () => {
  it("CONTENT-R21 pages of the site go through the router", () => {
    for (const href of ["/", "/about", "/this-site#stack", "/sheets/projects", "/sign-in"]) {
      expect(isPageHref(href), href).toBe(true);
    }
  });

  it("CONTENT-R21 server endpoints, queries and other origins load normally", () => {
    for (const href of [
      "/auth/linear/start",
      "/auth/sign-out",
      "/theme",
      "/healthz",
      "/readyz",
      "/webhooks/linear",
      "/sign-in?next=%2Fabout",
      "//example.com/about",
      "https://github.com/ulyssesv/linear",
      "#main",
    ]) {
      expect(isPageHref(href), href).toBe(false);
    }
    expect(isPageHref("/themes")).toBe(true);
  });
});
