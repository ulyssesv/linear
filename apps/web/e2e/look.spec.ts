// The look's testable parts: footer disclaimer, theme control, same-origin loading
// (CONTENT-R17 to R19). `local` project only.
import type { Page } from "@playwright/test";
import { navigation } from "../src/site.ts";
import { expect, test } from "./auth.ts";

const publicPaths = ["/", ...navigation.map((item) => item.href), "/sign-in"];

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const dark = "rgb(8, 9, 10)";
const light = "rgb(255, 255, 255)";

test.describe("footer", () => {
  for (const path of [...publicPaths, "/no/such/page"]) {
    test(`CONTENT-R17 ${path} states the site is independent, next to the build`, async ({
      page,
    }) => {
      await page.goto(path);
      const footer = page.getByRole("contentinfo");
      await expect(footer.getByTestId("disclaimer")).toHaveText(
        "An independent project, not affiliated with or endorsed by Linear.",
      );
      await expect(footer.getByTestId("version")).toBeVisible();
      await expect(footer.getByTestId("commit")).toBeVisible();
      await expect(footer.getByRole("link", { name: "Source on GitHub" })).toBeVisible();
    });
  }

  test("CONTENT-R17 a demo page carries the disclaimer too", async ({ page, signIn }) => {
    await signIn();
    await page.goto("/sheets");
    await expect(page.getByTestId("disclaimer")).toBeVisible();
  });
});

test.describe("theme", () => {
  test("CONTENT-R18 follows the system preference by default", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/about");
    expect(await page.locator("html").getAttribute("data-theme")).toBeNull();
    expect(await background(page)).toBe(dark);
    await page.emulateMedia({ colorScheme: "light" });
    expect(await background(page)).toBe(light);
    await expect(page.getByRole("button", { name: "System theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("CONTENT-R18 the cookie is applied during server rendering", async ({
    context,
    baseURL,
    request,
  }) => {
    await context.addCookies([{ name: "theme", value: "dark", url: baseURL as string }]);
    const html = await (await context.request.get("/about")).text();
    expect(html).toMatch(/<html lang="en" data-theme="dark">/);
    const plain = await (await request.get("/about")).text();
    expect(plain).toMatch(/<html lang="en">/);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false, colorScheme: "light" });

    test("CONTENT-R18 the control sets light, dark and system", async ({ page }) => {
      await page.goto("/this-site?x=1");
      expect(await background(page)).toBe(light);

      await page.getByRole("button", { name: "Dark theme" }).click();
      await expect(page).toHaveURL(/\/this-site\?x=1$/);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      expect(await background(page)).toBe(dark);
      await expect(page.getByRole("button", { name: "Dark theme" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await page.goto("/about");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

      await page.getByRole("button", { name: "System theme" }).click();
      await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
      expect(await background(page)).toBe(light);
    });
  });

  test("CONTENT-R18 with JavaScript the control updates in place", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/ai-sdlc");
    await page.evaluate(() => {
      (window as unknown as { marker: number }).marker = 1;
    });
    await page.getByRole("button", { name: "Light theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("button", { name: "Light theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await background(page)).toBe(light);
    // Same document: no navigation happened.
    expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

test.describe("same-origin loading", () => {
  for (const path of [...publicPaths, "/no/such/page"]) {
    test(`CONTENT-R19 ${path} requests nothing from another origin`, async ({ page, baseURL }) => {
      const origin = new URL(baseURL as string).origin;
      const foreign: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.protocol !== "data:" && url.origin !== origin) foreign.push(request.url());
      });
      await page.goto(path, { waitUntil: "networkidle" });
      expect(foreign).toEqual([]);
      // The fonts the page uses were served by the site itself.
      const fonts = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family);
      });
      expect(fonts).toContain("Inter Variable");
    });
  }
});

test.describe("font loading", () => {
  test("CONTENT-R19 the text font is preloaded from the site, the same file the stylesheet uses", async ({
    page,
    baseURL,
  }) => {
    const requested: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/inter-latin-wght-normal-")) requested.push(request.url());
    });
    await page.goto("/", { waitUntil: "networkidle" });
    const preload = page.locator('head link[rel="preload"][as="font"]');
    await expect(preload).toHaveCount(1);
    await expect(preload).toHaveAttribute("type", "font/woff2");
    await expect(preload).toHaveAttribute("crossorigin", "anonymous");
    const href = new URL((await preload.getAttribute("href")) as string, baseURL).href;
    // One request: the @font-face of the stylesheet reuses the preloaded response, so the
    // first paint does not wait for the stylesheet to discover the font.
    expect(requested).toEqual([href]);
  });
});
