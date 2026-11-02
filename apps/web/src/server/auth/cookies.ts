// Cookie parsing and serialisation for the auth handlers, which work on plain Request and
// Response objects so they can be tested without the framework.

export type CookieOptions = {
  maxAge?: number;
  secure: boolean;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict";
  path?: string;
};

/** Cookies of a request; later duplicates do not override the first. */
export function parseCookies(header: string | null | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === "" || cookies.has(name)) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

/** A Set-Cookie value. HttpOnly, SameSite=Lax and Path=/ unless told otherwise. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? "/"}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly ?? true) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

/** A Set-Cookie value that removes the cookie. */
export function clearCookie(name: string, options: Pick<CookieOptions, "secure">): string {
  return serializeCookie(name, "", { ...options, maxAge: 0 });
}

/** Cookies set by the server are Secure exactly when the public origin is https. */
export function isSecureOrigin(publicUrl: string): boolean {
  return new URL(publicUrl).protocol === "https:";
}
