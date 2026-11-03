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

  test("CONTENT-R14 CONTENT-R22 /about shows the author's captioned photo beside the text", async ({
    page,
  }) => {
    const photo = page.getByRole("main").getByRole("complementary").locator("img[data-photo]");
    await expect(photo).toHaveAttribute("loading", "eager");
    await expect(photo).toHaveAttribute("alt", /Ulysses/);
    await expect(photo).toHaveJSProperty("complete", true);
    expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(
      page.getByRole("main").getByRole("complementary").locator("figcaption"),
    ).toHaveText("Caucasus, October 2026");
  });

  test("CONTENT-R14 /about shows a short biography, marked as placeholder", async ({ page }) => {
    const main = page.getByRole("main");
    await expect(main.locator("[data-excerpt]")).toHaveText(/\S/);
    await expect(main.locator("[data-biography]")).toHaveText(/\S/);
    await expect(main.locator("[data-callout]")).toContainText("Placeholder");
  });

  test("CONTENT-R14 /about links to the author's GitHub and LinkedIn profiles as badges", async ({
    page,
  }) => {
    const main = page.getByRole("main");
    const github = main.getByRole("link", { name: "GitHub", exact: true });
    await expect(github).toHaveAttribute("href", "https://github.com/ulyssesv");
    await expect(github).toHaveAttribute("data-profile", "github");
    await expect(github.locator("svg")).toBeVisible();
    const linkedin = main.getByRole("link", { name: "LinkedIn", exact: true });
    await expect(linkedin).toHaveAttribute("href", "https://www.linkedin.com/in/ulyssesv/");
    await expect(linkedin).toHaveAttribute("data-profile", "linkedin");
    await expect(linkedin.locator("svg")).toBeVisible();
    await expect(main.locator('a[href^="mailto:"]')).toHaveCount(0);
  });
});
