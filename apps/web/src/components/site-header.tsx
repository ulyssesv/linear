import { signInHref, signOutPath } from "@/auth";
import type { SessionUser } from "@/server/auth/sessions";
import { navigation, site } from "@/site";

// The header of every page, public or demo (CONTENT-R3): the site name, the navigation
// with the current page marked, the theme control's slot and the account control.
// Server-rendered and usable without JavaScript: below the small breakpoint the
// navigation folds into a <details> menu (CONTENT-R6), and sign-out is a plain form POST.
export function SiteHeader({
  user,
  pathname,
  href,
}: Readonly<{
  user: SessionUser | null;
  /** The current path, for aria-current. */
  pathname: string;
  /** The current path with its query and hash, to return to after signing in or out. */
  href: string;
}>) {
  const links = <NavLinks pathname={pathname} />;
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 text-sm">
        <a href="/" className="font-semibold tracking-tight hover:text-muted-foreground">
          {site.name}
        </a>

        <nav aria-label="Main" className="hidden flex-1 sm:block">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">{links}</ul>
        </nav>

        <div className="ml-auto flex items-center gap-3 sm:ml-0">
          {/* The theme control (CONTENT-R18) arrives here with CONTENT T2. */}
          <div data-slot="theme" />
          <AccountControl user={user} href={href} />
          <details className="group relative sm:hidden">
            <summary className="cursor-pointer list-none rounded-md border px-2 py-1 [&::-webkit-details-marker]:hidden">
              Menu
            </summary>
            <nav
              aria-label="Main"
              className="absolute right-0 z-10 mt-2 w-48 rounded-md border bg-background p-2 shadow-sm"
            >
              <ul className="flex flex-col">{links}</ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

function NavLinks({ pathname }: Readonly<{ pathname: string }>) {
  return navigation.map((item) => {
    const current = pathname === item.href;
    return (
      <li key={item.href}>
        <a
          href={item.href}
          aria-current={current ? "page" : undefined}
          className="block py-1 text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground"
        >
          {item.label}
        </a>
      </li>
    );
  });
}

// The account control (CONTENT-R4, MIRROR-R15): a sign-in link that returns to this page,
// or the user's name and a sign-out button that returns here when this page is public.
function AccountControl({ user, href }: Readonly<{ user: SessionUser | null; href: string }>) {
  return (
    <nav aria-label="Account" className="flex items-center gap-3">
      {user ? (
        <>
          <span
            data-testid="signed-in-user"
            className="max-w-32 truncate sm:max-w-48 text-muted-foreground"
          >
            {user.name}
          </span>
          <form method="post" action={signOutPath}>
            <input type="hidden" name="next" value={href} />
            <button
              type="submit"
              className="underline underline-offset-4 hover:text-muted-foreground"
            >
              Sign out
            </button>
          </form>
        </>
      ) : (
        <a
          href={signInHref(href)}
          className="underline underline-offset-4 hover:text-muted-foreground"
        >
          Sign in
        </a>
      )}
    </nav>
  );
}
