import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { NotFound } from "@/components/not-found";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ViewerContext } from "@/components/viewer";
import { getSessionUser } from "@/server/auth/functions";
import type { SessionUser } from "@/server/auth/sessions";
import { site } from "@/site";
import { type Theme, themeAttribute } from "@/theme";
import { requestTheme } from "@/theme-request";
import styles from "../styles.css?url";

type AuthContext = { status: "ok" | "unavailable"; user: SessionUser | null };

export const Route = createRootRoute({
  // Who is signed in, for the header and the sheet guard (MIRROR-R15). Without a session
  // cookie this answers null without touching the database, so public pages never depend
  // on it; when the session store fails, public pages render signed out and the sheet
  // guard refuses.
  // The theme comes from its cookie, read on the server for the first paint (CONTENT-R18).
  beforeLoad: async (): Promise<{ auth: AuthContext; theme: Theme }> => {
    const theme = requestTheme();
    try {
      return { auth: { status: "ok", user: await getSessionUser() }, theme };
    } catch {
      return { auth: { status: "unavailable", user: null }, theme };
    }
  },
  // Pages override the title and description; a path that matches no route gets its own
  // title here (CONTENT-R7).
  head: ({ matches }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      {
        // Every page has a route below the root; only a path that matches none has not.
        title: matches.length === 1 ? `Page not found · ${site.name}` : site.name,
      },
      {
        name: "description",
        content: "A cover letter to Linear: ideas and experiments, built in the open.",
      },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
});

// One shell for every page, public or demo (CONTENT-R3): header, the page, footer.
function RootComponent() {
  const { auth, theme } = Route.useRouteContext();
  const location = useRouterState({ select: (state) => state.location });
  return (
    <RootDocument theme={theme}>
      <ViewerContext value={auth.user}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <div className="flex min-h-dvh flex-col">
          <SiteHeader
            user={auth.user}
            theme={theme}
            pathname={location.pathname}
            href={location.href}
          />
          <main id="main" className="flex-1">
            <Outlet />
          </main>
          <SiteFooter />
        </div>
      </ViewerContext>
    </RootDocument>
  );
}

function RootDocument({ theme, children }: Readonly<{ theme: Theme; children: ReactNode }>) {
  return (
    <html lang="en" data-theme={themeAttribute(theme)}>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
