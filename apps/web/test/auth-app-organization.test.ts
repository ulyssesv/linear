// The workspace a sign-in must belong to is the app's own (MIRROR-R16, REC-005).
import { describe, expect, it } from "vitest";
import { createAppOrganizationLookup } from "../src/server/auth/app-organization.ts";
import { linearGraphqlUrl } from "../src/server/linear/client.ts";
import { linearTokenUrl } from "../src/server/linear/token.ts";
import { json, scriptedFetch, tokenResponse } from "./linear-fakes.ts";

const env = { LINEAR_CLIENT_ID: "test-client-id", LINEAR_CLIENT_SECRET: "test-client-secret" };

describe("app organization", () => {
  it("MIRROR-R16 is read with the app's client-credentials token and cached", async () => {
    const { fetch, calls } = scriptedFetch(
      tokenResponse("app-token"),
      json({ data: { organization: { id: "org-1" } } }),
    );
    const lookup = createAppOrganizationLookup(env, { fetch });
    expect(await lookup()).toBe("org-1");
    expect(await lookup()).toBe("org-1");
    expect(calls.map((call) => call.url)).toEqual([linearTokenUrl, linearGraphqlUrl]);
    expect(new Headers(calls[1]?.init.headers).get("authorization")).toBe("Bearer app-token");
  });

  it("MIRROR-R16 does not cache a failure", async () => {
    const { fetch } = scriptedFetch(
      tokenResponse("app-token"),
      json({ errors: [{ message: "boom" }] }, { status: 500 }),
      json({ data: { organization: { id: "org-1" } } }),
    );
    const lookup = createAppOrganizationLookup(env, { fetch });
    await expect(lookup()).rejects.toThrow(/HTTP 500/);
    expect(await lookup()).toBe("org-1");
  });
});
