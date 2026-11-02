import { createFileRoute } from "@tanstack/react-router";
import { database } from "@/server/db/client";
import { receiveLinearWebhook } from "@/server/webhooks/receive";

// The path is linearWebhookPath in src/server/linear/urls.ts (MIRROR-R3, MIRROR-R11); the
// webhook test posts to that constant through the built server.
export const Route = createFileRoute("/webhooks/linear")({
  server: {
    handlers: {
      POST: ({ request }) =>
        receiveLinearWebhook(request, {
          database,
          secret: process.env.LINEAR_WEBHOOK_SECRET,
        }),
    },
  },
});
