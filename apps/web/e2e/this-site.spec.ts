// The page about how the site is built, delivered and developed (CONTENT-R13).
import { expect, test } from "@playwright/test";
import { site } from "../src/site.ts";

const sections = [
  { id: "stack", heading: "How it is built" },
  { id: "hosting", heading: "Self-hosted" },
  { id: "delivery", heading: "How it is released and deployed" },
  { id: "process", heading: "Specs, records and the Linear loop" },
  { id: "ai", heading: "How AI is used in the work" },
];

const links = [
  site.repository,
  `${site.repository}/tree/main/docs/specs`,
  `${site.repository}/tree/main/docs/records`,
  `${site.repository}/blob/main/AGENTS.md`,
];

test.describe("/this-site", () => {
  test.use({ javaScriptEnabled: false });

  test("CONTENT-R13 has the five sections with stable anchors, each with a heading", async ({
    page,
  }) => {
    await page.goto("/this-site");
    const main = page.getByRole("main");
    for (const { id, heading } of sections) {
      const anchor = main.locator(`#${id}`);
      await expect(anchor).toHaveCount(1);
      await expect(anchor).toHaveRole("heading");
      await expect(anchor).toHaveText(heading);
    }
    await expect(main.getByRole("heading", { level: 2 })).toHaveText(
      sections.map((section) => section.heading),
    );
  });

  test("CONTENT-R13 links to the repository, its specs, its records and AGENTS.md", async ({
    page,
  }) => {
    await page.goto("/this-site");
    const main = page.getByRole("main");
    for (const href of links) {
      await expect(main.locator(`a[href="${href}"]`).first()).toBeVisible();
    }
  });

  test("CONTENT-R13 CONTENT-R22 the hosting section shows the rack photo as WebP", async ({
    page,
  }) => {
    await page.goto("/this-site");
    const main = page.getByRole("main");
    await expect(main.getByText("single-node Kubernetes on Talos Linux")).toBeVisible();
    const photo = main.locator("figure[data-figure] img[data-photo]");
    await expect(photo).toHaveAttribute("loading", "lazy");
    await photo.scrollIntoViewIfNeeded();
    await expect(photo).toHaveJSProperty("complete", true);
    const loaded = await photo.evaluate((img: HTMLImageElement) => ({
      width: img.naturalWidth,
      src: img.currentSrc,
    }));
    expect(loaded.width).toBeGreaterThan(0);
    expect(loaded.src).toMatch(/\/assets\/rack-\d+-[^/]+\.webp$/);
  });

  test("CONTENT-R13 an anchor link lands on its section", async ({ page }) => {
    await page.goto("/this-site#ai");
    await expect(
      page.getByRole("heading", { name: "How AI is used in the work" }),
    ).toBeInViewport();
  });
});
