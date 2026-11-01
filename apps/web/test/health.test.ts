import { describe, expect, it } from "vitest";
import { healthz, readyz } from "../src/server/health.ts";
import { createReadinessRegistry } from "../src/server/readiness.ts";

const info = { version: "v1.2.3", commit: "abc" };

describe("/healthz", () => {
  it("SEED-R20 returns 200 with status, version and commit", async () => {
    const response = healthz(info);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", version: "v1.2.3", commit: "abc" });
  });
});

describe("/readyz", () => {
  it("SEED-R20 returns 200 with an empty checks object when none are registered", async () => {
    const response = await readyz(createReadinessRegistry());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", checks: {} });
  });

  it("SEED-R20 returns 200 when every registered check passes", async () => {
    const registry = createReadinessRegistry();
    registry.register("database", async () => {});
    registry.register("cache", () => {});
    const response = await readyz(registry);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      checks: { database: { status: "ok" }, cache: { status: "ok" } },
    });
  });

  it("SEED-R20 returns 503 naming the failing checks", async () => {
    const registry = createReadinessRegistry();
    registry.register("database", async () => {
      throw new Error("connection refused");
    });
    registry.register("cache", () => {});
    const response = await readyz(registry);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "fail",
      failing: ["database"],
      checks: {
        database: { status: "fail", error: "connection refused" },
        cache: { status: "ok" },
      },
    });
  });

  it("SEED-R20 fails a check that does not answer within the timeout", async () => {
    const registry = createReadinessRegistry();
    registry.register("slow", () => new Promise(() => {}));
    const response = await readyz(registry, { timeoutMs: 20 });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "fail",
      failing: ["slow"],
      checks: { slow: { status: "fail", error: "timed out after 20 ms" } },
    });
  });

  it("SEED-R20 refuses to register two checks under one name", () => {
    const registry = createReadinessRegistry();
    registry.register("database", () => {});
    expect(() => registry.register("database", () => {})).toThrow(/already registered/);
  });
});
