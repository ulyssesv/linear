// Signed-in end-to-end tests without Linear. The helper writes a user and a session
// straight into the database the `local` server uses and puts the session cookie on the
// browser context, exactly as a completed sign-in would. The production server has no
// test-only sign-in route.
//
//   import { expect, test } from "./auth.ts";
//   test("...", async ({ page, signIn }) => {
//     const user = await signIn();              // or signIn({ name: "Grace Hopper" })
//     await page.goto("/sheets/projects");
//   });
//
// Users created here are removed with their sessions after each test.
import { randomBytes } from "node:crypto";
import { type BrowserContext, test as base } from "@playwright/test";
import postgres from "postgres";
import { createSession, type SessionUser, sessionCookieName } from "../src/server/auth/sessions.ts";
import { e2eDatabaseUrl, e2eSessionSecret } from "./server-env.ts";

export type E2EUser = SessionUser & { sessionId: string };

/** Creates a user and a session and signs `context` in at `baseURL`. */
export async function signInAs(
  context: BrowserContext,
  baseURL: string,
  user: Partial<SessionUser> = {},
): Promise<E2EUser> {
  const suffix = randomBytes(4).toString("hex");
  const id = user.id ?? `e2e-user-${suffix}`;
  const name = user.name ?? "E2E Tester";
  const email = user.email ?? `e2e-${suffix}@example.com`;
  const sql = postgres(e2eDatabaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`
      insert into auth_users (id, organization_id, name, email, last_sign_in_at)
      values (${id}, 'e2e-organization', ${name}, ${email}, now())
      on conflict (id) do update set name = excluded.name, email = excluded.email
    `;
    const sessionId = await createSession(sql, { secret: e2eSessionSecret }, id);
    await context.addCookies([
      {
        name: sessionCookieName(baseURL),
        value: sessionId,
        url: baseURL,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    return { id, name, email, sessionId };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Deletes users made by signInAs, with their sessions. */
export async function removeUsers(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const sql = postgres(e2eDatabaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`delete from auth_users where id in ${sql(ids)}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Playwright's `test` with a `signIn` fixture that signs the page's context in. */
export const test = base.extend<{ signIn: (user?: Partial<SessionUser>) => Promise<E2EUser> }>({
  signIn: async ({ context, baseURL }, use) => {
    const created: string[] = [];
    await use(async (user) => {
      if (!baseURL) throw new Error("signIn needs the project's baseURL");
      const signedIn = await signInAs(context, baseURL, user);
      created.push(signedIn.id);
      return signedIn;
    });
    await removeUsers(created);
  },
});

export { expect } from "@playwright/test";
