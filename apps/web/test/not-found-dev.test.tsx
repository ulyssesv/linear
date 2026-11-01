import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "../src/routeTree.gen.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

// The production bundle strips TanStack's development warnings, so this renders the
// source router, where NODE_ENV is not production and the warning would fire.
describe("not-found page in development", () => {
  it("SEED-R29 renders without a warning about a missing not-found component", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/no/such/page"] }),
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    const messages = warn.mock.calls.map((args) => args.join(" "));
    expect(messages.filter((message) => /notFoundComponent/.test(message))).toEqual([]);
    expect(html).toContain("Page not found");
  });
});
