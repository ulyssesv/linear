// Handlers behind /healthz and /readyz (SEED-R20).
import type { ReadinessRegistry } from "./readiness.ts";
import type { BuildInfo } from "./resolve-build-info.ts";

const headers = { "cache-control": "no-store" };

export function healthz(info: BuildInfo): Response {
  return Response.json({ status: "ok", version: info.version, commit: info.commit }, { headers });
}

export async function readyz(
  registry: ReadinessRegistry,
  options?: { timeoutMs?: number },
): Promise<Response> {
  const { ok, checks } = await registry.run(options);
  if (ok) return Response.json({ status: "ok", checks }, { headers });
  const failing = Object.keys(checks).filter((name) => checks[name]?.status === "fail");
  return Response.json({ status: "fail", failing, checks }, { status: 503, headers });
}
