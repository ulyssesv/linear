// Environment contract (SEED-R22). The seed requires PORT and PUBLIC_URL, both with defaults.
// Reserved names are accepted and passed through unvalidated until the spec that uses them
// gives them a schema.

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

const schema = {
  PORT: { default: "3000", parse: port },
  PUBLIC_URL: { default: "http://localhost:3000", parse: origin },
} as const;

/** Names reserved for later specs (planning sheet: Postgres, Electric, auth, Linear OAuth). */
export const reservedEnv = [
  "DATABASE_URL",
  "ELECTRIC_URL",
  "ELECTRIC_SECRET",
  "SESSION_SECRET",
  "LINEAR_CLIENT_ID",
  "LINEAR_CLIENT_SECRET",
] as const;

export type Env = { PORT: number; PUBLIC_URL: string } & {
  [K in (typeof reservedEnv)[number]]?: string;
};

export type EnvResult = { ok: true; env: Env } | { ok: false; errors: string[] };

export function parseEnv(source: Readonly<Record<string, string | undefined>>): EnvResult {
  const errors: string[] = [];
  const parsed: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(schema)) {
    const result = spec.parse(source[name] ?? spec.default);
    if (result.ok) parsed[name] = result.value;
    else errors.push(`${name}: ${result.error}`);
  }
  for (const name of reservedEnv) {
    const value = source[name];
    if (value !== undefined) parsed[name] = value;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, env: parsed as Env };
}
