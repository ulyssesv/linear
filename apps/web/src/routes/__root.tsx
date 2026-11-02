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
import styles from "../styles.css?url";

type AuthContext = { status: "ok" | "unavailable"; user: SessionUser | null };

export const Route = createRootRoute({
  // Who is signed in, for the header and the sheet guard (MIRROR-R15). Without a session
  // cookie this answers null without touching the database, so public pages never depend
  // on it; when the session store fails, public pages render signed out and the sheet
  // guard refuses.
  beforeLoad: async (): Promise<{ auth: AuthContext }> => {
    try {
      return { auth: { status: "ok", user: await getSessionUser() } };
    } catch {
      return { auth: { status: "unavailable", user: null } };
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
        content: "Proofs of concept and documentation for proposals to Linear.",
      },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
});

// One shell for every page, public or demo (CONTENT-R3): header, the page, footer.
function RootComponent() {
  const { auth } = Route.useRouteContext();
  const location = useRouterState({ select: (state) => state.location });
  return (
    <RootDocument>
      <ViewerContext value={auth.user}>
        <div className="flex min-h-dvh flex-col">
          <SiteHeader user={auth.user} pathname={location.pathname} href={location.href} />
          <main className="flex-1">
            <Outlet />
          </main>
          <SiteFooter />
        </div>
      </ViewerContext>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
