import { createFileRoute } from "@tanstack/react-router";
import { withAuthDeps } from "@/server/auth/runtime";
import { handleCallback } from "@/server/auth/sign-in";

// The OAuth redirect URI, linearOAuthCallbackPath (MIRROR-R3, MIRROR-R16).
export const Route = createFileRoute("/auth/linear/callback")({
  server: {
    handlers: {
      GET: ({ request }) => withAuthDeps((deps) => handleCallback(request, deps)),
    },
  },
});
