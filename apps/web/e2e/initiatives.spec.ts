// The initiative pages (CONTENT-R12): title, status, problem and proposal, demo section
// anonymous and signed in, and links to Linear and the repository. `local` project only:
// signed-in tests write a session through e2e/auth.ts.
import type { Page } from "@playwright/test";
import { proofsOfConcept, site } from "../src/site.ts";
import { expect, test } from "./auth.ts";

const initiatives = [
  {
    path: "/planning-sheet",
    key: "planning-sheet",
    title: "Planning sheet",
    status: "In progress",
    demo: { name: "Open the planning sheet", href: "/sheets" },
    docs: [
      "docs/specs/002-planning-sheet-mirror.md",
      "docs/records/004-grid-handsontable-behind-an-adapter.md",
      "docs/records/005-linear-identities-and-login.md",
    ],
  },
  {
    path: "/metrics-rollup",
    key: "metrics-rollup",
    title: "Metrics rollup",
    status: "Planned",
    demo: undefined,
    docs: ["docs/specs", "docs/records"],
  },
  {
    path: "/ai-sdlc",
    key: "ai-sdlc",
    title: "AI SDLC",
    status: "Planned",
    demo: undefined,
    docs: ["docs/records/001-code-is-the-source-of-truth.md", "docs/specs"],
  },
] as const;

const article = (page: Page) => page.getByRole("main").locator("article");
const section = (page: Page, heading: string) =>
  article(page).locator(`h2:text-is("${heading}") + *`);

for (const initiative of initiatives) {
  test.describe(initiative.path, () => {
    test(`CONTENT-R12 shows the title, the status, the problem and the proposal`, async ({
      page,
    }) => {
      await page.goto(initiative.path);
      const body = article(page);
      await expect(body.getByRole("heading", { level: 1 })).toHaveText(initiative.title);
      await expect(body.locator("[data-status]")).toHaveText(`Status: ${initiative.status}`);
      for (const heading of ["Problem", "Proposal", "Demo", "Links"]) {
        await expect(body.getByRole("heading", { level: 2, name: heading })).toBeVisible();
      }
      await expect(section(page, "Problem")).not.toBeEmpty();
      await expect(section(page, "Proposal")).not.toBeEmpty();
    });

    test("CONTENT-R12 links to its Linear initiative and to its specs and records", async ({
      page,
    }) => {
      await page.goto(initiative.path);
      const poc = proofsOfConcept.find((item) => item.key === initiative.key);
      expect(poc).toBeDefined();
      const body = article(page);
      await expect(body.locator(`a[href="${poc?.link.href}"]`)).toHaveCount(1);
      for (const doc of initiative.docs) {
        const kind = doc.endsWith(".md") ? "blob" : "tree";
        await expect(
          body.locator(`a[href="${site.repository}/${kind}/main/${doc}"]`).first(),
        ).toBeVisible();
      }
    });

    if (initiative.demo) {
      const demo = initiative.demo;
      test("CONTENT-R12 the demo links to the demo and asks anonymous visitors to sign in", async ({
        page,
      }) => {
        await page.goto(initiative.path);
        const box = article(page).locator('[data-demo="link"]');
        await expect(box.getByRole("link", { name: demo.name })).toHaveAttribute("href", demo.href);
        await expect(box).toContainText(
          "The demo needs sign-in with a Linear account of the workspace.",
        );
        await expect(article(page).locator('[data-demo="none"]')).toHaveCount(0);
      });

      test("CONTENT-R12 a signed-in user goes straight to the demo, with no sign-in note", async ({
        page,
        signIn,
      }) => {
        await signIn();
        await page.goto(initiative.path);
        const box = article(page).locator('[data-demo="link"]');
        await expect(box.locator("[data-demo-sign-in]")).toHaveCount(0);
        await expect(box).not.toContainText("needs sign-in");
        await box.getByRole("link", { name: demo.name }).click();
        await expect(page).toHaveURL(new RegExp(`${demo.href}/?$`));
      });

      test("CONTENT-R12 an anonymous visitor following the demo link is asked to sign in", async ({
        page,
      }) => {
        await page.goto(initiative.path);
        await article(page).getByRole("link", { name: demo.name }).click();
        await expect(page).toHaveURL(/\/sign-in\?next=%2Fsheets/);
      });
    } else {
      test("CONTENT-R12 the demo section says there is no demo yet and links nowhere", async ({
        page,
      }) => {
        await page.goto(initiative.path);
        const demo = section(page, "Demo");
        await expect(demo).toHaveAttribute("data-demo", "none");
        await expect(demo).toHaveText("No demo is available yet.");
        await expect(demo.locator("a")).toHaveCount(0);
        await expect(article(page).locator('[data-demo="link"]')).toHaveCount(0);
      });
    }
  });
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("CONTENT-R12 the planning sheet's demo link and sign-in note are server-rendered", async ({
    page,
  }) => {
    await page.goto("/planning-sheet");
    const box = article(page).locator('[data-demo="link"]');
    await expect(box.getByRole("link")).toHaveAttribute("href", "/sheets");
    await expect(box).toContainText("needs sign-in with a Linear account of the workspace");
  });
});
