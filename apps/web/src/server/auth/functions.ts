// Server functions for routes (MIRROR-R15). The handler bodies run on the server only;
// the client bundle keeps an RPC stub, so nothing below reaches the browser.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { sessionUser } from "./runtime.ts";

/**
 * The signed-in user (`{ id, name, email }`) or null. Throws when the session store cannot
 * be read, so a guard fails closed instead of treating an outage as signed out.
 */
export const getSessionUser = createServerFn({ method: "GET" }).handler(() =>
  sessionUser(getRequest()),
);
