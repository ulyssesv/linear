import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { NotFound } from "@/components/not-found";
import { SiteHeader } from "@/components/site-header";
import { getSessionUser } from "@/server/auth/functions";
import type { SessionUser } from "@/server/auth/sessions";
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
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { title: "linear.sesv.co" },
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

function RootComponent() {
  const { auth } = Route.useRouteContext();
  return (
    <RootDocument>
      <SiteHeader user={auth.user} />
      <Outlet />
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
