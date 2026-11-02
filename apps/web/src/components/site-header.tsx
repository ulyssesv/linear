import { signInHref, signOutPath } from "@/auth";
import { MenuIcon } from "@/components/icons";
import { SiteLink } from "@/components/site-link";
import { ThemeControl } from "@/components/theme-control";
import type { SessionUser } from "@/server/auth/sessions";
import { navigation, site } from "@/site";
import type { Theme } from "@/theme";

// The header of every page, public or demo (CONTENT-R3): the site name, the navigation
// with the current page marked, the theme control (CONTENT-R18) and the account control.
// Server-rendered and usable without JavaScript: below the large breakpoint (1024px) the
// navigation folds into a <details> menu (CONTENT-R6), and sign-out and the theme are
// plain form POSTs.
export function SiteHeader({
  user,
  theme,
  pathname,
  href,
}: Readonly<{
  user: SessionUser | null;
  theme: Theme;
  /** The current path, for aria-current. */
  pathname: string;
  /** The current path with its query and hash, to return to after signing in or out. */
  href: string;
}>) {
  const links = <NavLinks pathname={pathname} />;
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2 text-[13px]">
        <SiteLink
          href="/"
          className="font-semibold text-foreground text-sm tracking-[-0.01em] hover:text-foreground/80"
        >
          {site.name}
        </SiteLink>

        <nav aria-label="Main" className="hidden flex-1 lg:block">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">{links}</ul>
        </nav>

        <div className="ml-auto flex items-center gap-3 lg:ml-0">
          <div data-slot="theme">
            <ThemeControl theme={theme} href={href} />
          </div>
          <AccountControl user={user} href={href} />
          <details className="group relative lg:hidden">
            <summary
              aria-label="Menu"
              className="grid size-7 cursor-pointer list-none place-items-center rounded-md border text-muted-foreground hover:text-foreground group-open:bg-accent group-open:text-foreground [&::-webkit-details-marker]:hidden"
            >
              <MenuIcon />
            </summary>
            <nav
              aria-label="Main"
              className="absolute right-0 z-10 mt-2 w-52 rounded-lg border bg-popover p-1.5 shadow-lg"
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
        <SiteLink
          href={item.href}
          aria-current={current ? "page" : undefined}
          className="block rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground lg:px-0 lg:py-1"
        >
          {item.label}
        </SiteLink>
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
            className="max-w-28 truncate text-muted-foreground sm:max-w-44"
          >
            {user.name}
          </span>
          <form method="post" action={signOutPath}>
            <input type="hidden" name="next" value={href} />
            <button
              type="submit"
              className="rounded-md border px-2.5 py-1 text-foreground transition-colors hover:bg-accent"
            >
              Sign out
            </button>
          </form>
        </>
      ) : (
        <SiteLink
          href={signInHref(href)}
          className="rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Sign in
        </SiteLink>
      )}
    </nav>
  );
}
