// The migrations in ./migrations, embedded at build time so dist/cli.mjs, and with it the
// image's `migrate` command, carries them without reading the source tree (MIRROR-R5).
// Add a migration as the next `NNNN_slug.sql`; never edit one that has been released.
import { parseMigrations } from "./migrate.ts";

export const migrations = parseMigrations(
  import.meta.glob<string>("./migrations/*.sql", { query: "?raw", import: "default", eager: true }),
);
