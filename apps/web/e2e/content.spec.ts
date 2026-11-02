// The site shell around every page (CONTENT-R1 to R4, CONTENT-R6, CONTENT-R7). `local`
// project only: signed-in tests write a session through e2e/auth.ts.
import type { Page } from "@playwright/test";
import { navigation, site } from "../src/site.ts";
import { expect, test } from "./auth.ts";

const publicPaths = ["/", ...navigation.map((item) => item.href)];

async function expectHeader(page: Page, current?: string) {
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: site.name, exact: true })).toHaveAttribute(
    "href",
    "/",
  );
  const nav = header.getByRole("navigation", { name: "Main" });
  for (const item of navigation) {
    const link = nav.getByRole("link", { name: item.label, exact: true });
    await expect(link).toHaveAttribute("href", item.href);
    if (item.href === current) await expect(link).toHaveAttribute("aria-current", "page");
    else await expect(link).not.toHaveAttribute("aria-current");
  }
  await expect(header.locator('[data-slot="theme"]')).toHaveCount(1);
  await expect(header.getByRole("navigation", { name: "Account" })).toBeVisible();
}

test.describe("public routes", () => {
  for (const path of publicPaths) {
    test(`CONTENT-R1 CONTENT-R2 ${path} answers 200 without a redirect`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(200);
    });
  }

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    for (const path of publicPaths) {
      test(`CONTENT-R2 CONTENT-R3 ${path} is readable, with the header`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectHeader(page, path === "/" ? undefined : path);
      });
    }
  });

  test("CONTENT-R2 demo routes keep the sign-in guard", async ({ request }) => {
    const response = await request.get("/sheets", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
  });
});

test.describe("header", () => {
  test("CONTENT-R3 the sign-in and not-found pages carry the same header", async ({ page }) => {
    await page.goto("/sign-in");
    await expectHeader(page);
    await page.goto("/no/such/page");
    await expectHeader(page);
  });

  test("CONTENT-R3 a demo page carries the same header", async ({ page, signIn }) => {
    await signIn();
    await page.goto("/sheets");
    await expectHeader(page);
  });

  test("CONTENT-R3 navigating marks the new page as current", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("banner").getByRole("navigation", { name: "Main" });
    await nav.getByRole("link", { name: "This site" }).click();
    await expect(page).toHaveURL(/\/this-site$/);
    await expectHeader(page, "/this-site");
    await page.getByRole("link", { name: site.name, exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expectHeader(page);
  });
});

test.describe("account control", () => {
  test("CONTENT-R4 an anonymous visitor gets a sign-in link back to this page", async ({
    page,
  }) => {
    await page.goto("/metrics-rollup?from=e2e");
    const account = page.getByRole("navigation", { name: "Account" });
    await account.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fmetrics-rollup%3Ffrom%3De2e$/);
    await expect(page.getByRole("link", { name: "Sign in with Linear" })).toHaveAttribute(
      "href",
      "/auth/linear/sign-in?next=%2Fmetrics-rollup%3Ffrom%3De2e",
    );
  });

  test("CONTENT-R4 Linear sign-in starts with the page to return to", async ({ request }) => {
    const response = await request.get("/auth/linear/sign-in?next=%2Fabout", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    const cookie = response.headers()["set-cookie"] ?? "";
    expect(cookie).toMatch(/linear_oauth=/);
  });

  test("CONTENT-R4 a signed-in user sees their name, and the sign-in page continues to the page", async ({
    page,
    signIn,
  }) => {
    const user = await signIn({ name: "Ada Lovelace" });
    await page.goto("/sign-in?next=%2Fabout");
    await expect(page.getByTestId("signed-in-user")).toHaveText(user.name);
    await page.getByRole("link", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("CONTENT-R4 signing out on a public page stays there", async ({ page, signIn }) => {
    await signIn();
    await page.goto("/ai-sdlc");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/ai-sdlc$/);
    await expect(page.getByRole("navigation", { name: "Account" })).toContainText("Sign in");
  });

  test("CONTENT-R4 signing out on a demo page lands on the home page", async ({ page, signIn }) => {
    await signIn();
    await page.goto("/sheets");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("navigation", { name: "Account" })).toContainText("Sign in");
  });
});

test.describe("narrow viewport", () => {
  test.use({ viewport: { width: 375, height: 740 }, javaScriptEnabled: false });

  for (const path of [...publicPaths, "/sign-in"]) {
    test(`CONTENT-R6 ${path} fits 375 pixels without horizontal scrolling`, async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("CONTENT-R6 a signed-in header fits too", async ({ page, signIn }) => {
    await signIn({ name: "Someone With A Rather Long Display Name" });
    await page.goto("/sheets");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("CONTENT-R6 the navigation folds into a menu that opens without JavaScript", async ({
    page,
  }) => {
    await page.goto("/about");
    const menu = page.getByRole("banner").locator("details");
    const link = menu.getByRole("link", { name: "Planning sheet" });
    await expect(link).toBeHidden();
    await menu.getByLabel("Menu").click();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/planning-sheet$/);
  });
});

test.describe("titles", () => {
  test("CONTENT-R7 every page has its own title and a description", async ({ page }) => {
    const titles = new Set<string>();
    for (const path of [...publicPaths, "/sign-in"]) {
      await page.goto(path);
      const title = await page.title();
      expect(title).not.toBe("");
      titles.add(title);
      const descriptions = page.locator('meta[name="description"]');
      await expect(descriptions).toHaveCount(1);
      expect(await descriptions.getAttribute("content")).toBeTruthy();
    }
    expect(titles.size).toBe(publicPaths.length + 1);
  });
});

test.describe("client-side navigation", () => {
  /** Marks the current document; a full reload loses the mark. */
  const mark = (page: Page) =>
    page.evaluate(() => {
      (window as unknown as { __document: string }).__document = "kept";
    });
  const marked = (page: Page) =>
    page.evaluate(() => (window as unknown as { __document?: string }).__document);

  test("CONTENT-R21 header links change the page without reloading the document", async ({
    page,
  }) => {
    await page.goto("/");
    await mark(page);
    const nav = page.getByRole("banner").getByRole("navigation", { name: "Main" });
    for (const item of navigation) {
      await nav.getByRole("link", { name: item.label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${item.href}$`));
      await expectHeader(page, item.href);
      await expect(page.locator('meta[name="description"]')).toHaveCount(1);
      expect(await marked(page)).toBe("kept");
    }
    await page.getByRole("link", { name: site.name, exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await marked(page)).toBe("kept");
  });

  test("CONTENT-R21 landing cards and links in the copy change the page in place", async ({
    page,
  }) => {
    await page.goto("/");
    await mark(page);
    await page.locator('[data-initiative="ai-sdlc"] a').click();
    await expect(page).toHaveURL(/\/ai-sdlc$/);
    await expect(page).toHaveTitle(/AI SDLC/);
    expect(await marked(page)).toBe("kept");
    await page.goto("/this-site");
    await mark(page);
    await page.locator("article").getByRole("link", { name: "AI SDLC", exact: true }).click();
    await expect(page).toHaveURL(/\/ai-sdlc$/);
    expect(await marked(page)).toBe("kept");
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("CONTENT-R21 the same links are ordinary links", async ({ page }) => {
      await page.goto("/");
      const nav = page.getByRole("banner").getByRole("navigation", { name: "Main" });
      const first = navigation[0];
      await nav.getByRole("link", { name: first.label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${first.href}$`));
      await expectHeader(page, first.href);
    });
  });
});
