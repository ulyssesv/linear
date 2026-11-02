// Server functions behind the sheets (MIRROR-R18, MIRROR-R24). Each checks the session
// itself: the /sheets layout guard protects the pages, not these endpoints (MIRROR-R15).
// The handler bodies run on the server only; the client bundle keeps an RPC stub. All are
// GET: a sheet only ever reads (MIRROR-R20).
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { signInPath } from "../../auth.ts";
import { parseSheetChangesInput } from "../../sheets/freshness.ts";
import type { SheetKind } from "../../sheets/model.ts";
import { sessionUser } from "../auth/runtime.ts";
import { database } from "../db/client.ts";
import { loadSheetViewFor, NotSignedInError, sheetChangesFor } from "./load.ts";

async function sheet(kind: SheetKind) {
  setResponseHeader("cache-control", "no-store");
  try {
    return await loadSheetViewFor(await sessionUser(getRequest()), database(), kind);
  } catch (error) {
    if (error instanceof NotSignedInError) {
      throw redirect({ href: `${signInPath}?next=${encodeURIComponent(`/sheets/${kind}`)}` });
    }
    throw error;
  }
}

export const getProjectsSheet = createServerFn({ method: "GET" }).handler(() => sheet("projects"));

export const getInitiativesSheet = createServerFn({ method: "GET" }).handler(() =>
  sheet("initiatives"),
);

/**
 * The freshness poll of an open sheet (MIRROR-R24). An expired session answers
 * `{ signedIn: false }` rather than redirecting, so the page stops polling and offers to
 * sign in again without leaving the sheet.
 */
export const getSheetChanges = createServerFn({ method: "GET" })
  .validator(parseSheetChangesInput)
  .handler(async ({ data }) => {
    setResponseHeader("cache-control", "no-store");
    return sheetChangesFor(await sessionUser(getRequest()), database(), data);
  });
