import { Link, useRouter } from "@tanstack/react-router";
import type { ComponentProps } from "react";

// Links between the site's pages go through the router, so following one renders the next
// page in place instead of reloading the document (CONTENT-R21). The router still renders
// an ordinary <a href>, which is what a visitor without JavaScript follows.

/** Paths served by server handlers, not pages: the browser must load these itself. */
const serverPath = /^\/(?:auth|webhooks)\/|^\/(?:theme|healthz|readyz)(?:$|[/?#])/;

/**
 * Whether the router can show `href` in place: a same-origin path to a page, without a
 * query string (links with one, such as the sign-in link with `next`, load normally).
 */
export function isPageHref(href: string): boolean {
  return (
    href.startsWith("/") && !href.startsWith("//") && !href.includes("?") && !serverPath.test(href)
  );
}

export function SiteLink({ href, ...props }: ComponentProps<"a"> & { href: string }) {
  // Outside a router (a component rendered on its own in a unit test) it is a plain link.
  const router = useRouter({ warn: false });
  if (!router || !isPageHref(href)) return <a href={href} {...props} />;
  const [path = "/", hash] = href.split("#");
  return (
    <Link
      to={path}
      hash={hash || undefined}
      // Only the page itself is current, not every page below "/".
      activeOptions={{ exact: true, includeHash: false }}
      {...props}
    />
  );
}
