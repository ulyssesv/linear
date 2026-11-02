// The theme cookie and its handler (CONTENT-R18).
import { describe, expect, it } from "vitest";
import { handleSetTheme } from "../src/server/theme.ts";
import { themeAttribute, themeFromCookies } from "../src/theme.ts";

const post = (fields: Record<string, string>) =>
  handleSetTheme(
    new Request("http://localhost/theme", { method: "POST", body: new URLSearchParams(fields) }),
  );

describe("theme", () => {
  it("CONTENT-R18 reads the theme from the cookie, defaulting to system", () => {
    expect(themeFromCookies(undefined)).toBe("system");
    expect(themeFromCookies("theme=dark")).toBe("dark");
    expect(themeFromCookies("a=1; theme=light")).toBe("light");
    expect(themeFromCookies("theme=purple")).toBe("system");
    expect(themeAttribute("system")).toBeUndefined();
    expect(themeAttribute("dark")).toBe("dark");
  });

  it.each(["light", "dark"])(
    "CONTENT-R18 storing %s sets a year-long cookie and goes back",
    async (theme) => {
      const response = await post({ theme, next: "/about?x=1" });
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/about?x=1");
      expect(response.headers.get("set-cookie")).toBe(
        `theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`,
      );
    },
  );

  it("CONTENT-R18 system clears the cookie", async () => {
    const response = await post({ theme: "system", next: "/" });
    expect(response.headers.get("set-cookie")).toBe("theme=; Path=/; Max-Age=0; SameSite=Lax");
  });

  it("CONTENT-R18 CONTENT-R5 an unknown theme changes nothing and a foreign next goes home", async () => {
    const response = await post({ theme: "purple", next: "https://evil.example/" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
