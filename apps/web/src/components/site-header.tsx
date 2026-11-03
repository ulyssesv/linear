import { signInHref, signOutPath } from "@/auth";
import { MenuIcon } from "@/components/icons";
import { LinearMark } from "@/components/linear-mark";
import { SiteLink } from "@/components/site-link";
import { ThemeControl } from "@/components/theme-control";
import type { SessionUser } from "@/server/auth/sessions";
import { navigation, site } from "@/site";
import type { Theme } from "@/theme";

// The header of every page, public or demo (CONTENT-R3): the site name, the navigation
// with the current page marked, the theme control (CONTENT-R18) and the account control.
// Server-rendered and usable without JavaScript: below the large breakpoint (1024px) the
// navigation folds into a <details> menu (CONTENT-R6), and sign-out and the theme are
// plain form POSTs. The header stays one row down to phone widths, signed in or not; below
// the small breakpoint (640px) the signed-in name moves from the header into the menu.
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
      <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-6 py-2 sm:gap-x-6 text-[13px]">
        <SiteLink
          href="/"
          className="font-semibold text-foreground text-sm tracking-[-0.01em] hover:text-foreground/80"
        >
          {site.name}
        </SiteLink>

        <nav aria-label="Main" className="hidden flex-1 lg:block">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">{links}</ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3 lg:ml-0">
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
            <div className="absolute right-0 z-10 mt-2 w-52 rounded-lg border bg-popover p-1.5 shadow-lg">
              {user ? (
                // Below the small breakpoint the header has no room for the name; the menu
                // says who is signed in instead (CONTENT-R4, CONTENT-R6).
                <p
                  data-menu-user
                  className="mb-1 break-words border-b px-2 pt-1 pb-2 text-muted-foreground sm:hidden"
                >
                  Signed in as <span className="text-foreground">{user.name}</span>
                </p>
              ) : null}
              <nav aria-label="Main">
                <ul className="flex flex-col">{links}</ul>
              </nav>
            </div>
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

// The account control (CONTENT-R4, MIRROR-R15): a sign-in link with Linear's mark that
// returns to this page (CONTENT-R16), or one bordered group, like the theme control, with
// the user's name (from the small breakpoint up) and a sign-out button that returns here
// when this page is public.
function AccountControl({ user, href }: Readonly<{ user: SessionUser | null; href: string }>) {
  return (
    <nav aria-label="Account" className="flex items-center">
      {user ? (
        <div data-account className="flex h-7 items-stretch rounded-md border">
          {/* Hidden on phones so the header stays one row; the menu shows it there. */}
          <span
            data-testid="signed-in-user"
            className="hidden max-w-44 self-center truncate px-2.5 text-muted-foreground sm:block"
          >
            {user.name}
          </span>
          <form method="post" action={signOutPath} className="flex sm:border-l">
            <input type="hidden" name="next" value={href} />
            <button
              type="submit"
              className="whitespace-nowrap rounded-[5px] px-2.5 text-foreground transition-colors hover:bg-accent sm:rounded-l-none"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : (
        <SiteLink
          href={signInHref(href)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <LinearMark className="size-3.5" />
          Sign in
        </SiteLink>
      )}
    </nav>
  );
}
