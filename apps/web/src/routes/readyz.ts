import { createFileRoute } from "@tanstack/react-router";
import { readyz } from "@/server/health";
import { readiness } from "@/server/readiness";

export const Route = createFileRoute("/readyz")({
  server: { handlers: { GET: () => readyz(readiness) } },
});
