// Scratch databases for tests (MIRROR-R8). They live on the server DATABASE_URL names, or
// on the compose database when it is unset, and are dropped afterwards, so no test reads
// or writes anything a developer keeps in a database of their own.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { localDatabaseUrl } from "../src/server/db/local.ts";

export type ScratchDatabase = { url: string; drop(): Promise<void> };

/** Creates an empty database on the server `base` points at. */
export async function createScratchDatabase(
  label: string,
  base = process.env.DATABASE_URL || localDatabaseUrl,
): Promise<ScratchDatabase> {
  const name = `linear_test_${label}_${randomBytes(4).toString("hex")}`;
  const admin = postgres(base, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    await admin.unsafe(`create database "${name}"`);
  } catch (error) {
    await admin.end({ timeout: 0 });
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Tests that need Postgres could not create a database on ${where(base)}: ${reason}. ` +
        "Start the compose database with `pnpm db:up`, or point DATABASE_URL at a server " +
        "where this role may create databases (MIRROR-R8).",
    );
  }
  const url = new URL(base);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    async drop() {
      try {
        await admin.unsafe(`drop database if exists "${name}" with (force)`);
      } finally {
        await admin.end({ timeout: 5 });
      }
    },
  };
}

/** Host, port and database of a URL, without its credentials. */
function where(raw: string): string {
  const url = new URL(raw);
  return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
}
