import { createFileRoute } from "@tanstack/react-router";
import { withAuthDeps } from "@/server/auth/runtime";
import { handleSignInStart } from "@/server/auth/sign-in";

// Starts sign in with Linear (MIRROR-R16): remembers the attempt, redirects to Linear.
export const Route = createFileRoute("/auth/linear/sign-in")({
  server: {
    handlers: {
      GET: ({ request }) => withAuthDeps((deps) => handleSignInStart(request, deps)),
    },
  },
});
