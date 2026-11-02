import { signInPath, signOutPath } from "@/auth";
import type { SessionUser } from "@/server/auth/sessions";

// Account bar on every page (MIRROR-R15): who is signed in and a sign-out button, or a link
// to sign in. Server-rendered; sign-out is a plain form POST, so it works without
// JavaScript.
export function SiteHeader({ user }: Readonly<{ user: SessionUser | null }>) {
  return (
    <nav
      aria-label="Account"
      className="mx-auto flex max-w-4xl items-center justify-end gap-3 px-6 pt-4 text-sm"
    >
      {user ? (
        <>
          <span data-testid="signed-in-user" className="text-muted-foreground">
            {user.name}
          </span>
          <form method="post" action={signOutPath}>
            <button
              type="submit"
              className="underline underline-offset-4 hover:text-muted-foreground"
            >
              Sign out
            </button>
          </form>
        </>
      ) : (
        <a href={signInPath} className="underline underline-offset-4 hover:text-muted-foreground">
          Sign in
        </a>
      )}
    </nav>
  );
}
