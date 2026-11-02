import { createFileRoute } from "@tanstack/react-router";
import { withAuthDeps } from "@/server/auth/runtime";
import { handleSignOut } from "@/server/auth/sign-in";

// Ends the session (MIRROR-R17). POST only, from the header's sign-out form.
export const Route = createFileRoute("/auth/sign-out")({
  server: {
    handlers: {
      POST: ({ request }) => withAuthDeps((deps) => handleSignOut(request, deps)),
    },
  },
});
