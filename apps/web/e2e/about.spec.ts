// The about page: name, biography and contact links (CONTENT-R14). The landing half of
// R14, the shared excerpt, is covered with the landing page.
import { expect, test } from "@playwright/test";

test.describe("about page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/about");
  });

  test("CONTENT-R14 /about shows the author's name", async ({ page }) => {
    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { level: 2, name: "Ulysses", exact: true }),
    ).toBeVisible();
  });

  test("CONTENT-R14 /about shows a short biography, marked as placeholder", async ({ page }) => {
    const main = page.getByRole("main");
    await expect(main.locator("[data-excerpt]")).toHaveText(/\S/);
    await expect(main.locator("[data-biography]")).toHaveText(/\S/);
    await expect(main.locator("[data-callout]")).toContainText("Placeholder");
  });

  test("CONTENT-R14 /about links to the author's GitHub profile", async ({ page }) => {
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "github.com/ulyssesv" })).toHaveAttribute(
      "href",
      "https://github.com/ulyssesv",
    );
    await expect(main.locator('a[href^="mailto:"]')).toHaveCount(0);
  });
});
