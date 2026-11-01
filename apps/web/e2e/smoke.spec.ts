// Checks only the `smoke` project runs, against a deployed BASE_URL (SEED-R27).
import { expect, test } from "@playwright/test";

const expected = process.env.EXPECTED_COMMIT || undefined;

test("SEED-R27 runs against BASE_URL", ({ baseURL }) => {
  expect(baseURL, "BASE_URL is required for the smoke project").toBeTruthy();
});

test("SEED-R27 the served commit matches EXPECTED_COMMIT", async ({ request, page }) => {
  test.skip(!expected, "EXPECTED_COMMIT is not set");
  const health = await (await request.get("/healthz")).json();
  // A short SHA is accepted as a prefix of the full one.
  expect(health.commit.startsWith(expected as string), `served ${health.commit}`).toBe(true);
  await page.goto("/");
  await expect(page.getByTestId("commit")).toHaveText((expected as string).slice(0, 7));
});
