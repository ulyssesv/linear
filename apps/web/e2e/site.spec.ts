// Site checks shared by the `local` and `smoke` projects (SEED-R27 runs them against BASE_URL).
import { expect, test } from "@playwright/test";
import { proofsOfConcept, site } from "../src/site.ts";

test.describe("landing page", () => {
  test("SEED-R17 shows the site name, purpose, proof-of-concept cards and repository link", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(site.name);
    await expect(page.getByText(site.purpose)).toBeVisible();

    const cards = page.locator("[data-poc]");
    await expect(cards).toHaveCount(proofsOfConcept.length);
    for (const poc of proofsOfConcept) {
      const card = page.locator(`[data-poc="${poc.key}"]`);
      await expect(card.getByRole("heading", { level: 3 })).toHaveText(poc.title);
      await expect(card.getByText(poc.status, { exact: true })).toBeVisible();
      await expect(card.getByRole("link", { name: poc.link.label })).toHaveAttribute(
        "href",
        poc.link.href,
      );
    }

    await expect(page.locator(`a[href="${site.repository}"]`)).toBeVisible();
  });

  test("SEED-R17 footer shows the deployed version and short commit from /healthz", async ({
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
