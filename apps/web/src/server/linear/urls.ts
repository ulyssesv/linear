// Absolute URLs the server gives to Linear (MIRROR-R3). They derive from PUBLIC_URL alone,
// never from an incoming request: behind the proxy, Host and X-Forwarded-* are whatever the
// client or a misconfigured hop says (LIN-21). The paths are fixed here; the routes that
// serve them mount at the same constants, and the Linear OAuth app is configured with the
// URLs these functions return for the production PUBLIC_URL.

/** OAuth redirect URI for sign in with Linear (MIRROR-R16). */
export const linearOAuthCallbackPath = "/auth/linear/callback";

/** Webhook endpoint of the Linear OAuth app (MIRROR-R11). */
export const linearWebhookPath = "/webhooks/linear";

type PublicOrigin = { readonly PUBLIC_URL: string };

function absolute(env: PublicOrigin, path: string): string {
  return new URL(path, env.PUBLIC_URL).href;
}

/** `${PUBLIC_URL}/auth/linear/callback`, the redirect_uri of every authorize request. */
export function linearOAuthCallbackUrl(env: PublicOrigin): string {
  return absolute(env, linearOAuthCallbackPath);
}

/** `${PUBLIC_URL}/webhooks/linear`, the webhook URL set in the Linear OAuth app. */
export function linearWebhookUrl(env: PublicOrigin): string {
  return absolute(env, linearWebhookPath);
}
