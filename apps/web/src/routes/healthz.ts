import { createFileRoute } from "@tanstack/react-router";
import { buildInfo } from "@/server/build-info";
import { healthz } from "@/server/health";

export const Route = createFileRoute("/healthz")({
  server: { handlers: { GET: () => healthz(buildInfo) } },
});
