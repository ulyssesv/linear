// Sheet data from the mirror (MIRROR-R18, MIRROR-R24). Every entity of the sheet's kind is
// returned, archived and removed ones included and flagged; the page hides the flagged
// rows until asked. The /sheets layout guard does not cover server functions, so the
// session check happens here, before any read (MIRROR-R15).
//
// An open sheet polls sheetChanges with the marker it holds (sheets/freshness.ts says what
// comes back and why). The marker is always read before the rows, so a write that lands
// in between is either in the rows already or reported again by the next poll; merging by
// id makes a repeat harmless.

import type {
  SheetChange,
  SheetChanges,
  SheetChangesInput,
  SheetFreshness,
  SheetView,
} from "../../sheets/freshness.ts";
import { buildInitiativesSheet } from "../../sheets/initiatives.ts";
import type { SheetKind, SheetModel } from "../../sheets/model.ts";
import { buildProjectsSheet } from "../../sheets/projects.ts";
import type { SessionUser } from "../auth/sessions.ts";
import type { Db } from "../mirror/apply.ts";
import { changedTypes, listMirrored, mirrorFreshness } from "../mirror/read.ts";

export class NotSignedInError extends Error {
  override name = "NotSignedInError";
  constructor() {
    super("Sign in to see the sheets.");
  }
}

const all = { includeRemoved: true };

/**
 * A sheet built from the mirror. With `afterSeq`, the sheet's own entities are only those
 * written after it while reference data is read in full: the rows of what changed.
 */
async function buildSheet(sql: Db, kind: SheetKind, afterSeq?: number): Promise<SheetModel> {
  const own = { ...all, afterSeq };
  if (kind === "projects") {
    const [projects, projectStatuses, users, teams, projectLabels, initiatives] = await Promise.all(
      [
        listMirrored(sql, "projects", own),
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
    listMirrored(sql, "initiatives", own),
    listMirrored(sql, "users", all),
    listMirrored(sql, "teams", all),
    listMirrored(sql, "initiativeLabels", all),
    listMirrored(sql, "projects", all),
  ]);
  return buildInitiativesSheet({ initiatives, users, teams, initiativeLabels, projects });
}

export function loadSheet(sql: Db, kind: SheetKind): Promise<SheetModel> {
  return buildSheet(sql, kind);
}

/** The sheet with the freshness marker read just before it (MIRROR-R24). */
export async function loadSheetView(sql: Db, kind: SheetKind): Promise<SheetView> {
  const freshness = await mirrorFreshness(sql);
  return { model: await buildSheet(sql, kind), freshness };
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

/** The sheet's view for a signed-in user; throws NotSignedInError for anyone else. */
export async function loadSheetViewFor(
  user: SessionUser | null,
  sql: Db,
  kind: SheetKind,
): Promise<SheetView> {
  if (!user) throw new NotSignedInError();
  return loadSheetView(sql, kind);
}

/**
 * What changed in a sheet since the client's marker (MIRROR-R24): nothing, the rebuilt
 * rows of the sheet's own entities, or the whole sheet (see sheets/freshness.ts).
 */
export async function sheetChanges(
  sql: Db,
  since: SheetChangesInput,
): Promise<{ freshness: SheetFreshness; change: SheetChange | null }> {
  const freshness = await mirrorFreshness(sql);
  if (freshness.version === since.version && freshness.bulkRun === since.bulkRun) {
    return { freshness, change: null };
  }
  const full = async (): Promise<SheetChange> => ({
    type: "full",
    model: await buildSheet(sql, since.kind),
  });
  // A bulk run may have committed below the client's version; a lower version means rows
  // were deleted, which only test cleanup does. Either way only a full read is right.
  if (freshness.bulkRun !== since.bulkRun || freshness.version < since.version) {
    return { freshness, change: await full() };
  }
  const changed = await changedTypes(sql, since.version);
  if (changed.some((type) => type !== since.kind)) return { freshness, change: await full() };
  const { rows } = await buildSheet(sql, since.kind, since.version);
  return { freshness, change: { type: "rows", rows } };
}

/** sheetChanges for a signed-in user; anyone else is told to sign in, nothing is read. */
export async function sheetChangesFor(
  user: SessionUser | null,
  sql: Db,
  since: SheetChangesInput,
): Promise<SheetChanges> {
  if (!user) return { signedIn: false };
  return { signedIn: true, ...(await sheetChanges(sql, since)) };
}
