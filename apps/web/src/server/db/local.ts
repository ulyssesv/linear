// The database from compose.yaml (MIRROR-R8). The dev server, the unit tests and the
// end-to-end tests fall back to it when DATABASE_URL is not set; production always sets it.
export const localDatabaseUrl = "postgres://linear:linear@localhost:55432/linear";
