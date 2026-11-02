// Site checks shared by the `local` and `smoke` projects (SEED-R27 runs them against BASE_URL).
import { expect, test } from "@playwright/test";
import { initiativePages, site } from "../src/site.ts";

test.describe("landing page", () => {
  test("CONTENT-R11 shows the purpose, one card per initiative, this site and the author", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(site.name);
    await expect(page.locator("[data-purpose]")).not.toBeEmpty();

    const cards = page.locator("[data-initiative]");
    await expect(cards).toHaveCount(initiativePages.length);
    for (const initiative of initiativePages) {
      const card = page.locator(`[data-initiative="${initiative.key}"]`);
      await expect(card.getByRole("heading", { level: 3 })).not.toBeEmpty();
      await expect(card.locator("p")).not.toBeEmpty();
      await expect(card.locator("[data-status]")).toHaveText(/Status: (Planned|In progress|Live)/);
      await expect(card.getByRole("link")).toHaveAttribute("href", initiative.href);
    }

    const thisSite = page.locator('[data-section="this-site"]');
    await expect(thisSite.getByRole("heading", { level: 2 })).toHaveText("This site");
    await expect(thisSite.getByRole("link", { name: "How it is built" })).toHaveAttribute(
      "href",
      "/this-site",
    );
    const about = page.locator('[data-section="about"]');
    await expect(about.getByRole("link", { name: "More about the author" })).toHaveAttribute(
      "href",
      "/about",
    );
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.locator(`a[href="${site.repository}"]`)).toBeVisible();
  });

  test("CONTENT-R11 a card leads to its initiative page with the same title and status", async ({
    page,
  }) => {
    for (const initiative of initiativePages) {
      await page.goto("/");
      const card = page.locator(`[data-initiative="${initiative.key}"]`);
      const title = await card.getByRole("heading", { level: 3 }).textContent();
      const status = await card.locator("[data-status]").textContent();
      await card.getByRole("link").click();
      await expect(page).toHaveURL(new RegExp(`${initiative.href}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title ?? "");
      await expect(page.locator("[data-status]")).toHaveText(status ?? "");
    }
  });

  test("CONTENT-R14 the landing excerpt is the one on the about page", async ({ page }) => {
    await page.goto("/");
    const onLanding = await page.locator('[data-section="about"] [data-excerpt]').textContent();
    expect(onLanding?.trim()).not.toBe("");
    await page.goto("/about");
    await expect(page.locator("[data-excerpt]")).toHaveText(onLanding ?? "");
  });

  test("CONTENT-R17 footer shows the deployed version and short commit from /healthz", async ({
    page,
    request,
  }) => {
    const health = await (await request.get("/healthz")).json();
    await page.goto("/");
    await expect(page.getByTestId("version")).toHaveText(health.version);
    await expect(page.getByTestId("commit")).toHaveText(shortCommit(health.commit));
  });
});

test.describe("health endpoints", () => {
  test("SEED-R20 GET /healthz returns 200 with status, version and commit", async ({ request }) => {
    const response = await request.get("/healthz");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.version).toEqual(expect.any(String));
    expect(body.version).not.toBe("");
    expect(body.commit).toEqual(expect.any(String));
    expect(body.commit).not.toBe("");
  });

  test("SEED-R20 GET /readyz returns 200 with status and checks", async ({ request }) => {
    const response = await request.get("/readyz");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks).toEqual(expect.any(Object));
  });
});

// Mirrors src/server/build-info.ts without importing it: that module needs the Vite define.
function shortCommit(commit: string): string {
  return /^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 7) : commit;
}
