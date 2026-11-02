import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { signInPath } from "@/auth";

// Every sheet route sits under this layout and requires a signed-in user (MIRROR-R15). The
// check runs on the server for the first request, so an anonymous visitor gets a redirect
// to the sign-in page before any sheet code loads; client navigations ask the server too.
// Server functions that return sheet data must check the session themselves as well.
export const Route = createFileRoute("/sheets")({
  beforeLoad: ({ context, location }) => {
    if (context.auth.status === "unavailable") {
      throw new Error("Sign-in is unavailable right now; try again shortly.");
    }
    if (!context.auth.user) {
      throw redirect({ href: `${signInPath}?next=${encodeURIComponent(location.href)}` });
    }
    return { user: context.auth.user };
  },
  component: Outlet,
});
