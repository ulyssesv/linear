// The test run's database (MIRROR-R8), created by global-setup.ts.
import { inject } from "vitest";
import { createScratchDatabase } from "./scratch-db.ts";

/** URL of this run's database. Throws why there is none, which fails the calling test. */
export function testDatabaseUrl(): string {
  const database = inject("database");
  if ("error" in database) throw new Error(database.error);
  return database.url;
}

/** A further empty database, for tests that must start from nothing. Drop it afterwards. */
export function scratchDatabase(label: string) {
  return createScratchDatabase(label, testDatabaseUrl());
}
