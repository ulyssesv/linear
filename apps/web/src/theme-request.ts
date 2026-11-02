// The theme of the current request (CONTENT-R18): from the Cookie header while rendering
// on the server, so the first paint uses it, and from document.cookie in the browser.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { type Theme, themeFromCookies } from "./theme.ts";

export const requestTheme = createIsomorphicFn()
  .server((): Theme => {
    // Outside a request (rendering the router in a unit test) there is no cookie to read.
    try {
      return themeFromCookies(getRequest().headers.get("cookie"));
    } catch {
      return "system";
    }
  })
  .client((): Theme => themeFromCookies(document.cookie));
