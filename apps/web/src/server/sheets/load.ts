// Sheet data from the mirror (MIRROR-R18). Every entity of the sheet's kind is returned,
// archived and removed ones included and flagged; the page hides the flagged rows until
// asked. The /sheets layout guard does not cover server functions, so the session check
// happens here, before any read (MIRROR-R15).

import { buildInitiativesSheet } from "../../sheets/initiatives.ts";
import type { SheetKind, SheetModel } from "../../sheets/model.ts";
import { buildProjectsSheet } from "../../sheets/projects.ts";
import type { SessionUser } from "../auth/sessions.ts";
import type { Db } from "../mirror/apply.ts";
import { listMirrored } from "../mirror/read.ts";

export class NotSignedInError extends Error {
  override name = "NotSignedInError";
  constructor() {
    super("Sign in to see the sheets.");
  }
}

const all = { includeRemoved: true };

export async function loadSheet(sql: Db, kind: SheetKind): Promise<SheetModel> {
  if (kind === "projects") {
    const [projects, projectStatuses, users, teams, projectLabels, initiatives] = await Promise.all(
      [
        listMirrored(sql, "projects", all),
        listMirrored(sql, "projectStatuses", all),
        listMirrored(sql, "users", all),
        listMirrored(sql, "teams", all),
        listMirrored(sql, "projectLabels", all),
        listMirrored(sql, "initiatives", all),
      ],
    );
    return buildProjectsSheet({
      projects,
      projectStatuses,
      users,
      teams,
      projectLabels,
      initiatives,
    });
  }
  const [initiatives, users, teams, initiativeLabels, projects] = await Promise.all([
    listMirrored(sql, "initiatives", all),
    listMirrored(sql, "users", all),
    listMirrored(sql, "teams", all),
    listMirrored(sql, "initiativeLabels", all),
    listMirrored(sql, "projects", all),
  ]);
  return buildInitiativesSheet({ initiatives, users, teams, initiativeLabels, projects });
}

/** The sheet for a signed-in user; throws NotSignedInError for anyone else. */
export async function loadSheetFor(
  user: SessionUser | null,
  sql: Db,
  kind: SheetKind,
): Promise<SheetModel> {
  if (!user) throw new NotSignedInError();
  return loadSheet(sql, kind);
}
