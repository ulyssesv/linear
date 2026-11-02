// Theme vocabulary shared by the server handler, the root route and the header control
// (CONTENT-R18). Isomorphic: no server imports.
import { parseCookies } from "./server/auth/cookies.ts";

export const themes = ["light", "dark", "system"] as const;
export type Theme = (typeof themes)[number];

export const themeCookieName = "theme";
export const themePath = "/theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (themes as readonly string[]).includes(value);
}

/** The theme a Cookie header asks for; "system" when it names none. */
export function themeFromCookies(header: string | null | undefined): Theme {
  const value = parseCookies(header).get(themeCookieName);
  return isTheme(value) ? value : "system";
}

/** The data-theme attribute for `theme`: none for "system", so the media query decides. */
export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}
