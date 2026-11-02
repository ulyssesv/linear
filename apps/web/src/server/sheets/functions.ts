// Server functions behind the sheets (MIRROR-R18). Each checks the session itself: the
// /sheets layout guard protects the pages, not these endpoints (MIRROR-R15). The handler
// bodies run on the server only; the client bundle keeps an RPC stub.
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { signInPath } from "../../auth.ts";
import type { SheetKind } from "../../sheets/model.ts";
import { sessionUser } from "../auth/runtime.ts";
import { database } from "../db/client.ts";
import { loadSheetFor, NotSignedInError } from "./load.ts";

async function sheet(kind: SheetKind) {
  try {
    return await loadSheetFor(await sessionUser(getRequest()), database(), kind);
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
