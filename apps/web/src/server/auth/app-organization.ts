// The workspace the OAuth app is installed in (MIRROR-R16, REC-005), learned from the
// app's own client-credentials token, so no workspace setting of our own is needed. Asked
// once per process and cached; a failure is not cached, so the next sign-in asks again.
import { createAppLinearClient, type LinearClientOptions } from "../linear/client.ts";

const query = "query AppOrganization { organization { id } }";

export type AppOrganizationLookup = () => Promise<string>;

export function createAppOrganizationLookup(
  env: { readonly LINEAR_CLIENT_ID: string; readonly LINEAR_CLIENT_SECRET: string },
  options: Omit<LinearClientOptions, "tokens"> = {},
): AppOrganizationLookup {
  const client = createAppLinearClient(env, options);
  let cached: Promise<string> | undefined;
  return () => {
    cached ??= client
      .request<{ organization: { id: string } }>(query)
      .then(({ organization }) => {
        if (typeof organization?.id !== "string" || organization.id === "") {
          throw new Error("Linear returned no organization for the app token");
        }
        return organization.id;
      })
      .catch((error: unknown) => {
        cached = undefined;
        throw error;
      });
    return cached;
  };
}
