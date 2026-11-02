import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/server/env.ts";
import {
  linearOAuthCallbackPath,
  linearOAuthCallbackUrl,
  linearWebhookPath,
  linearWebhookUrl,
} from "../src/server/linear/urls.ts";
import { serveEnv } from "./serve-env.ts";

describe("URLs given to Linear", () => {
  it("MIRROR-R3 fixes the OAuth callback and webhook paths", () => {
    expect(linearOAuthCallbackPath).toBe("/auth/linear/callback");
    expect(linearWebhookPath).toBe("/webhooks/linear");
  });

  it("MIRROR-R3 derives the OAuth callback and webhook URLs from PUBLIC_URL", () => {
    const env = { PUBLIC_URL: "https://linear.sesv.co" };
    expect(linearOAuthCallbackUrl(env)).toBe("https://linear.sesv.co/auth/linear/callback");
    expect(linearWebhookUrl(env)).toBe("https://linear.sesv.co/webhooks/linear");
  });

  it("MIRROR-R3 uses the PUBLIC_URL parsed from the environment", () => {
    const result = parseEnv({
      PUBLIC_URL: "http://localhost:3000/",
      ...serveEnv,
    });
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(linearOAuthCallbackUrl(result.env)).toBe("http://localhost:3000/auth/linear/callback");
    expect(linearWebhookUrl(result.env)).toBe("http://localhost:3000/webhooks/linear");
  });

  it("MIRROR-R3 takes nothing from an incoming request", () => {
    // The builders accept the environment alone, so a Host or X-Forwarded-* header has no way in.
    expect(linearOAuthCallbackUrl.length).toBe(1);
    expect(linearWebhookUrl.length).toBe(1);
    const request = new Request("http://evil.example/auth/linear/start", {
      headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" },
    });
    const env = Object.assign(request, { PUBLIC_URL: "https://linear.sesv.co" });
    expect(linearOAuthCallbackUrl(env)).toBe("https://linear.sesv.co/auth/linear/callback");
    expect(linearWebhookUrl(env)).toBe("https://linear.sesv.co/webhooks/linear");
  });
});
