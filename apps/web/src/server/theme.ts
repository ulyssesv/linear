// POST /theme (CONTENT-R18): stores the chosen theme in a cookie and goes back to the page
// the form was posted from, so the control works without JavaScript. The cookie is not
// HttpOnly, because the client reads it to re-render after an in-place change, and carries
// nothing sensitive.
import { safeNext } from "../auth.ts";
import { isTheme, themeCookieName } from "../theme.ts";
import { serializeCookie } from "./auth/cookies.ts";

const oneYear = 365 * 24 * 60 * 60;

export async function handleSetTheme(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => new FormData());
  const theme = form.get("theme");
  const next = safeNext(form.get("next"));
  const headers = new Headers({ location: next, "cache-control": "no-store" });
  if (isTheme(theme)) {
    const cookie = { secure: false, httpOnly: false, sameSite: "Lax" as const };
    headers.append(
      "set-cookie",
      theme === "system"
        ? serializeCookie(themeCookieName, "", { ...cookie, maxAge: 0 })
        : serializeCookie(themeCookieName, theme, { ...cookie, maxAge: oneYear }),
    );
  }
  return new Response(null, { status: 303, headers });
}
