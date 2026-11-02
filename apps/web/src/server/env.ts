// Environment contract (SEED-R22). The seed requires PORT and PUBLIC_URL, both with defaults.
// A name without a default is validated when set and required only by the commands that
// pass it in `required` (DATABASE_URL: serve and migrate). Reserved names are accepted and
// passed through unvalidated until the spec that uses them gives them a schema.

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function port(raw: string): Parsed<number> {
  const value = Number(raw);
  return /^\d+$/.test(raw) && value >= 1 && value <= 65535
    ? { ok: true, value }
    : { ok: false, error: "must be an integer between 1 and 65535" };
}

function origin(raw: string): Parsed<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "must be an absolute http or https URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "must be an absolute http or https URL" };
  }
  if (url.origin !== raw.replace(/\/$/, "")) {
    return { ok: false, error: "must be an origin, without path, query or fragment" };
  }
  return { ok: true, value: url.origin };
}

// Never echoes the value: it carries the password.
function postgresUrl(raw: string): Parsed<string> {
  const error = "must be a postgres:// or postgresql:// URL with a host";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error };
  }
  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || url.hostname === "") {
    return { ok: false, error };
  }
  return { ok: true, value: raw };
}

type Entry = { default?: string; parse: (raw: string) => Parsed<unknown> };

const schema = {
  PORT: { default: "3000", parse: port },
  PUBLIC_URL: { default: "http://localhost:3000", parse: origin },
  // Postgres, direct and unpooled (MIRROR-R5, MIRROR-R6, docs/deploy.md).
  DATABASE_URL: { parse: postgresUrl },
} satisfies Record<string, Entry>;

/** Names without a default, which a command may require. */
export type RequirableEnv = "DATABASE_URL";

/** Names reserved for later specs (planning sheet: Electric, auth, Linear OAuth). */
export const reservedEnv = [
  "ELECTRIC_URL",
  "ELECTRIC_SECRET",
  "SESSION_SECRET",
  "LINEAR_CLIENT_ID",
  "LINEAR_CLIENT_SECRET",
] as const;

export type Env = { PORT: number; PUBLIC_URL: string; DATABASE_URL?: string } & {
  [K in (typeof reservedEnv)[number]]?: string;
};

export type EnvResult = { ok: true; env: Env } | { ok: false; errors: string[] };

export function parseEnv(
  source: Readonly<Record<string, string | undefined>>,
  required: readonly RequirableEnv[] = [],
): EnvResult {
  const errors: string[] = [];
  const parsed: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(schema) as [string, Entry][]) {
    const raw = source[name] ?? spec.default;
    if (raw === undefined) {
      if ((required as readonly string[]).includes(name)) errors.push(`${name}: is required`);
      continue;
    }
    const result = spec.parse(raw);
    if (result.ok) parsed[name] = result.value;
    else errors.push(`${name}: ${result.error}`);
  }
  for (const name of reservedEnv) {
    const value = source[name];
    if (value !== undefined) parsed[name] = value;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, env: parsed as Env };
}
