import { describe, expect, it } from "vitest";
import type { MirrorDoc, ParentRef } from "../src/mirror.ts";
import { formatAction, type LinearDocument, type MirrorApi, sync } from "../src/sync.ts";

const PROJECT: ParentRef = {
  kind: "project",
  key: "p1",
  url: "https://linear.app/acme/project/scaffold-p1",
};
const INITIATIVE: ParentRef = {
  kind: "initiative",
  key: "i1",
  url: "https://linear.app/acme/initiative/site-platform-i1",
};

function doc(prefix: string, title: string, parent: ParentRef, content = `${title} body`) {
  return {
    path: `docs/${prefix}.md`,
    prefix,
    title: `${prefix} ${title}`,
    parent,
    content,
  } satisfies MirrorDoc;
}

/** In-memory Linear: documents per parent key, and a log of every write. */
function fakeLinear(initial: Record<string, LinearDocument[]> = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, [...v]]));
  const writes: string[] = [];
  const contents = new Map<string, string>();
  let next = 1;
  const api: MirrorApi = {
    async documentsOn(parent) {
      if (parent.key === "missing") throw new Error("Entity not found");
      return { parentId: `uuid-${parent.key}`, documents: [...(store.get(parent.key) ?? [])] };
    },
    async createDocument(parent, parentId, input) {
      expect(parentId).toBe(`uuid-${parent.key}`);
      const created = { id: `d${next++}`, title: input.title };
      store.set(parent.key, [...(store.get(parent.key) ?? []), created]);
      contents.set(created.id, input.content);
      writes.push(`create ${parent.kind} ${input.title}`);
    },
    async updateDocument(id, input) {
      for (const docs of store.values()) {
        for (const d of docs) if (d.id === id) d.title = input.title;
      }
      contents.set(id, input.content);
      writes.push(`update ${id} ${input.title}`);
    },
  };
  return { api, store, writes, contents };
}

describe("sync", () => {
  it("SEED-R10 creates a document when the parent has none with the title prefix", async () => {
    const linear = fakeLinear({ p1: [{ id: "x", title: "SPEC-0011 Other" }] });

    const result = await sync([doc("SPEC-001", "Foo", PROJECT)], linear.api);

    expect(result.errors).toEqual([]);
    expect(result.actions.map((a) => a.kind)).toEqual(["create"]);
    expect(linear.writes).toEqual(["create project SPEC-001 Foo"]);
    expect(linear.contents.get("d1")).toBe("Foo body");
  });

  it("SEED-R10 updates the document found by title prefix in place, title included", async () => {
    const linear = fakeLinear({
      p1: [{ id: "spec1", title: "SPEC-001 Old title" }],
      i1: [{ id: "rec2", title: "REC-002 A decision" }],
    });

    const result = await sync(
      [doc("SPEC-001", "New title", PROJECT), doc("REC-002", "A decision", INITIATIVE)],
      linear.api,
    );

    expect(result.errors).toEqual([]);
    expect(result.actions.map((a) => [a.kind, a.documentId])).toEqual([
      ["update", "spec1"],
      ["update", "rec2"],
    ]);
    expect(linear.writes).toEqual([
      "update spec1 SPEC-001 New title",
      "update rec2 REC-002 A decision",
    ]);
  });

  it("SEED-R10 never creates duplicates when run repeatedly", async () => {
    const linear = fakeLinear();
    const docs = [doc("SPEC-001", "Foo", PROJECT), doc("REC-001", "Bar", INITIATIVE)];

    await sync(docs, linear.api);
    await sync(docs, linear.api);
    await sync(docs, linear.api);

    expect(linear.store.get("p1")?.map((d) => d.title)).toEqual(["SPEC-001 Foo"]);
    expect(linear.store.get("i1")?.map((d) => d.title)).toEqual(["REC-001 Bar"]);
    expect(linear.writes.filter((w) => w.startsWith("create"))).toHaveLength(2);
  });

  it("SEED-R10 refuses to choose between several documents with the same prefix", async () => {
    const linear = fakeLinear({
      p1: [
        { id: "a", title: "SPEC-001 Foo" },
        { id: "b", title: "SPEC-001 Foo (copy)" },
      ],
    });

    const result = await sync([doc("SPEC-001", "Foo", PROJECT)], linear.api);

    expect(linear.writes).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/2 documents titled SPEC-001/);
  });

  it("SEED-R10 reports a parent Linear cannot resolve and carries on with the rest", async () => {
    const linear = fakeLinear();
    const missing: ParentRef = { ...PROJECT, key: "missing" };

    const result = await sync(
      [doc("SPEC-001", "Foo", missing), doc("REC-001", "Bar", INITIATIVE)],
      linear.api,
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/Entity not found/);
    expect(linear.writes).toEqual(["create initiative REC-001 Bar"]);
  });

  it("SEED-R13 dry run performs no writes and lists every create and update", async () => {
    const linear = fakeLinear({ p1: [{ id: "spec1", title: "SPEC-001 Foo" }] });

    const result = await sync(
      [doc("SPEC-001", "Foo", PROJECT), doc("SPEC-002", "Bar", PROJECT)],
      linear.api,
      { dryRun: true },
    );

    expect(linear.writes).toEqual([]);
    expect(result.actions.map((a) => [a.kind, a.doc.title, a.documentId])).toEqual([
      ["update", "SPEC-001 Foo", "spec1"],
      ["create", "SPEC-002 Bar", undefined],
    ]);
  });

  it("SEED-R13 prints each planned write with its file and parent", () => {
    const create = { kind: "create" as const, doc: doc("SPEC-002", "Bar", PROJECT) };
    const update = {
      kind: "update" as const,
      doc: doc("REC-001", "Baz", INITIATIVE),
      documentId: "rec1",
    };

    expect(formatAction(create, true)).toBe(
      "would create SPEC-002 Bar (docs/SPEC-002.md) on project p1",
    );
    expect(formatAction(update, false)).toBe(
      "updated REC-001 Baz (docs/REC-001.md) on initiative i1, document rec1",
    );
  });
});
