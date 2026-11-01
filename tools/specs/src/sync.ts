// Creates or updates one Linear document per spec and record (SEED-R10), or only plans it (SEED-R13).
import type { Problem } from "./check.ts";
import type { MirrorDoc, ParentRef } from "./mirror.ts";

export type LinearDocument = { id: string; title: string };
export type DocumentInput = { title: string; content: string };

/** The few Linear calls the mirror needs. `linear.ts` implements it with `@linear/sdk`. */
export interface MirrorApi {
  /** Resolves the parent and lists the documents attached to it. Read only. */
  documentsOn(parent: ParentRef): Promise<{ parentId: string; documents: LinearDocument[] }>;
  createDocument(parent: ParentRef, parentId: string, input: DocumentInput): Promise<void>;
  updateDocument(id: string, input: DocumentInput): Promise<void>;
}

export type Action =
  | { kind: "create"; doc: MirrorDoc; documentId?: undefined }
  | { kind: "update"; doc: MirrorDoc; documentId: string };

export type SyncResult = { actions: Action[]; errors: Problem[] };

export async function sync(
  docs: MirrorDoc[],
  api: MirrorApi,
  options: { dryRun?: boolean; onAction?: (action: Action) => void } = {},
): Promise<SyncResult> {
  const actions: Action[] = [];
  const errors: Problem[] = [];

  for (const doc of docs) {
    try {
      const { parentId, documents } = await api.documentsOn(doc.parent);
      const matches = documents.filter(
        (d) => d.title === doc.prefix || d.title.startsWith(`${doc.prefix} `),
      );
      if (matches.length > 1) {
        const ids = matches.map((d) => d.id).join(", ");
        throw new Error(
          `${matches.length} documents titled ${doc.prefix} on ${doc.parent.url} (${ids}); ` +
            "archive the extras by hand",
        );
      }
      const input = { title: doc.title, content: doc.content };
      const existing = matches[0];
      let action: Action;
      if (existing) {
        action = { kind: "update", doc, documentId: existing.id };
        if (!options.dryRun) await api.updateDocument(existing.id, input);
      } else {
        action = { kind: "create", doc };
        if (!options.dryRun) await api.createDocument(doc.parent, parentId, input);
      }
      actions.push(action);
      options.onAction?.(action);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ path: doc.path, line: undefined, message: `${doc.title}: ${message}` });
    }
  }
  return { actions, errors };
}

export function formatAction(action: Action, dryRun: boolean): string {
  const verb = dryRun ? `would ${action.kind}` : `${action.kind}d`;
  const { doc } = action;
  const target = `${doc.parent.kind} ${doc.parent.key}`;
  const document = action.documentId === undefined ? "" : `, document ${action.documentId}`;
  return `${verb} ${doc.title} (${doc.path}) on ${target}${document}`;
}
