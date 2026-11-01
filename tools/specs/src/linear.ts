// MirrorApi on @linear/sdk. Kept thin: the sync logic is tested against a fake (SEED-R10).
import { LinearClient } from "@linear/sdk";
import type { ParentRef } from "./mirror.ts";
import type { LinearDocument, MirrorApi } from "./sync.ts";

export function linearApi(apiKey: string): MirrorApi {
  const client = new LinearClient({ apiKey });

  /** The parent's id and the first page of its documents. Projects, issues and initiatives
   * accept a slug id or identifier where the API asks for an id. */
  const documentsPage = async (parent: ParentRef) => {
    const first = 100;
    switch (parent.kind) {
      case "project": {
        const entity = await client.project(parent.key);
        return { id: entity.id, connection: await entity.documents({ first }) };
      }
      case "issue": {
        const entity = await client.issue(parent.key);
        return { id: entity.id, connection: await entity.documents({ first }) };
      }
      case "initiative": {
        const entity = await client.initiative(parent.key);
        return { id: entity.id, connection: await entity.documents({ first }) };
      }
    }
  };

  return {
    async documentsOn(parent) {
      const { id, connection } = await documentsPage(parent);
      while (connection.pageInfo.hasNextPage) await connection.fetchNext();
      const documents: LinearDocument[] = connection.nodes.map((d) => ({
        id: d.id,
        title: d.title,
      }));
      return { parentId: id, documents };
    },

    async createDocument(parent, parentId, input) {
      const on =
        parent.kind === "project"
          ? { projectId: parentId }
          : parent.kind === "issue"
            ? { issueId: parentId }
            : { initiativeId: parentId };
      const payload = await client.createDocument({ ...input, ...on });
      if (!payload.success) throw new Error("Linear did not create the document");
    },

    async updateDocument(id, input) {
      const payload = await client.updateDocument(id, input);
      if (!payload.success) throw new Error("Linear did not update the document");
    },
  };
}
