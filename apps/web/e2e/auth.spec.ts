// Public and protected routes (MIRROR-R15). `local` project only: signed-in tests write a
// session to the server's database through e2e/auth.ts; nothing here reaches Linear.
import { expect, test } from "./auth.ts";

test.describe("public routes", () => {
  for (const path of ["/", "/healthz", "/readyz", "/sign-in"]) {
    test(`MIRROR-R15 ${path} answers 200 without signing in`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(200);
    });
  }

  test("MIRROR-R15 the landing page offers sign-in and keeps its content", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("linear.sesv.co");
    await expect(page.getByRole("navigation", { name: "Account" })).toContainText("Sign in");
  });
});

test.describe("sheet routes", () => {
  for (const path of ["/sheets", "/sheets/projects", "/sheets/initiatives"]) {
    test(`MIRROR-R15 an anonymous request for ${path} is redirected to sign-in by the server`, async ({
      request,
    }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBeGreaterThanOrEqual(300);
      expect(response.status()).toBeLessThan(400);
      expect(response.headers().location).toBe(`/sign-in?next=${encodeURIComponent(path)}`);
    });
  }

  test("MIRROR-R15 the sign-in page carries the requested sheet location through", async ({
    page,
  }) => {
    await page.goto("/sheets?view=compact");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fsheets%3Fview%3Dcompact$/);
    await expect(page.getByRole("link", { name: "Sign in with Linear" })).toHaveAttribute(
      "href",
      "/auth/linear/sign-in?next=%2Fsheets%3Fview%3Dcompact",
    );
  });

  test("MIRROR-R15 a forged session cookie is treated as signed out", async ({
    context,
    baseURL,
    page,
  }) => {
    await context.addCookies([
      { name: "linear_session", value: "A".repeat(43), url: baseURL as string },
    ]);
    await page.goto("/sheets");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fsheets$/);
  });

  test("MIRROR-R15 a signed-in user sees the sheets, their name and a sign-out button", async ({
    page,
    signIn,
  }) => {
    const user = await signIn({ name: "Grace Hopper" });
    const response = await page.goto("/sheets");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Planning sheet");
    await expect(page.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "href",
      "/sheets/projects",
    );
    await expect(page.getByRole("link", { name: "Initiatives" })).toHaveAttribute(
      "href",
      "/sheets/initiatives",
    );
    await expect(page.getByTestId("signed-in-user")).toHaveText(user.name);
    // Nothing token-shaped reaches the page (MIRROR-R17).
    expect(await page.content()).not.toContain(user.sessionId);
  });

  test("MIRROR-R15 the header is server-rendered for a signed-in user", async ({
    page,
    signIn,
  }) => {
    const user = await signIn({ name: "Server Rendered" });
    const response = await page.request.get("/sheets");
    const html = await response.text();
    expect(html).toContain(user.name);
    expect(html).toContain('action="/auth/sign-out"');
    await page.goto("/");
    await expect(page.getByTestId("signed-in-user")).toHaveText(user.name);
  });

  test("MIRROR-R15 signing out ends access to the sheets", async ({ page, signIn }) => {
    await signIn();
    await page.goto("/sheets");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("navigation", { name: "Account" })).toContainText("Sign in");
    await page.goto("/sheets");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fsheets$/);
  });
});

test.describe("sign-in page", () => {
  test("MIRROR-R15 the button starts Linear OAuth with the PUBLIC_URL callback", async ({
    request,
    baseURL,
  }) => {
    const response = await request.get("/auth/linear/sign-in", { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    const location = new URL(response.headers().location ?? "");
    expect(`${location.origin}${location.pathname}`).toBe("https://linear.app/oauth/authorize");
    expect(location.searchParams.get("redirect_uri")).toBe(`${baseURL}/auth/linear/callback`);
    expect(location.searchParams.get("actor")).toBe("user");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  });

  test("MIRROR-R15 shows why a sign-in was refused", async ({ page }) => {
    await page.goto("/sign-in?error=not-in-workspace");
    await expect(page.getByRole("alert")).toContainText("not a member of the workspace");
    await page.goto("/sign-in?error=not-allowed");
    await expect(page.getByRole("alert")).toContainText("allowlist");
  });

  test("MIRROR-R15 a callback that did not start in this browser signs nobody in", async ({
    page,
  }) => {
    await page.goto("/auth/linear/callback?code=forged&state=forged");
    await expect(page).toHaveURL(/\/sign-in\?error=state$/);
    await expect(page.getByRole("alert")).toContainText("Try again");
    await page.goto("/sheets");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
