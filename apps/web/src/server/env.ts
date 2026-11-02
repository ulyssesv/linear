// Environment contract (SEED-R22, MIRROR-R7). Each command of the image validates only the
// names it uses and exits non-zero listing every missing or invalid one. Errors name the
// variable and the rule it breaks, never its value, because most of these are secrets.
// Reserved names are accepted and passed through unvalidated until the spec that uses them
// gives them a schema. docs/deploy.md lists every name for infra.

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

function postgresUrl(raw: string): Parsed<string> {
  const error = "must be a postgres:// or postgresql:// URL with a host";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error };
  }
  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || !url.hostname) {
    return { ok: false, error };
  }
  return { ok: true, value: raw };
}

function token(raw: string): Parsed<string> {
  return /\s/.test(raw)
    ? { ok: false, error: "must not contain whitespace" }
    : { ok: true, value: raw };
}

const minSecretLength = 32;

function secret(raw: string): Parsed<string> {
  return raw.length >= minSecretLength
    ? { ok: true, value: raw }
    : { ok: false, error: `must be at least ${minSecretLength} characters` };
}

/** 32 random bytes in standard base64, as printed by `openssl rand -base64 32`. */
function aes256Key(raw: string): Parsed<string> {
  const valid =
    /^[A-Za-z0-9+/]{43}=$/.test(raw) && Buffer.from(raw, "base64").toString("base64") === raw;
  return valid
    ? { ok: true, value: raw }
    : { ok: false, error: "must be 32 bytes encoded as standard base64 (44 characters)" };
}

/** Comma-separated emails, compared case-insensitively; blank entries are ignored. */
function emailList(raw: string): Parsed<string[] | undefined> {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
  if (entries.some((entry) => !/^[^\s@]+@[^\s@]+$/.test(entry))) {
    return { ok: false, error: "must be comma-separated email addresses" };
  }
  return { ok: true, value: entries.length > 0 ? entries : undefined };
}

type Variable<T> =
  | { kind: "default"; default: string; parse: (raw: string) => Parsed<T> }
  | { kind: "required"; parse: (raw: string) => Parsed<T> }
  | { kind: "optional"; parse: (raw: string) => Parsed<T> };

const variables = {
  PORT: { kind: "default", default: "3000", parse: port },
  PUBLIC_URL: { kind: "default", default: "http://localhost:3000", parse: origin },
  DATABASE_URL: { kind: "required", parse: postgresUrl },
  LINEAR_CLIENT_ID: { kind: "required", parse: token },
  LINEAR_CLIENT_SECRET: { kind: "required", parse: token },
  LINEAR_WEBHOOK_SECRET: { kind: "required", parse: token },
  SESSION_SECRET: { kind: "required", parse: secret },
  TOKEN_ENCRYPTION_KEY: { kind: "required", parse: aes256Key },
  SIGNIN_ALLOWLIST: { kind: "optional", parse: emailList },
} satisfies Record<string, Variable<unknown>>;

/** The full, validated environment. Each command sees the subset it declares. */
export type FullEnv = {
  /** Listen port. */
  PORT: number;
  /** External origin; every absolute URL given to Linear derives from it (MIRROR-R3). */
  PUBLIC_URL: string;
  /** Postgres connection, direct and unpooled. */
  DATABASE_URL: string;
  /** Linear OAuth app client id. */
  LINEAR_CLIENT_ID: string;
  /** Linear OAuth app client secret. Secret. */
  LINEAR_CLIENT_SECRET: string;
  /** Linear OAuth app webhook signing secret. Secret. */
  LINEAR_WEBHOOK_SECRET: string;
  /** Signs session cookies, at least 32 characters. Secret. */
  SESSION_SECRET: string;
  /** AES-256 key for per-user Linear tokens at rest, 32 bytes in standard base64. Secret. */
  TOKEN_ENCRYPTION_KEY: string;
  /** Lowercased emails allowed to sign in; unset lets every workspace member in. */
  SIGNIN_ALLOWLIST?: string[];
};

/** What each command of the image needs; nothing more is validated for it. */
export const commandEnv = {
  serve: [
    "PORT",
    "PUBLIC_URL",
    "DATABASE_URL",
    "LINEAR_CLIENT_ID",
    "LINEAR_CLIENT_SECRET",
    "LINEAR_WEBHOOK_SECRET",
    "SESSION_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "SIGNIN_ALLOWLIST",
  ],
  migrate: ["DATABASE_URL"],
  scheduler: ["DATABASE_URL", "LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET"],
} as const satisfies Record<string, readonly (keyof typeof variables)[]>;

export type Command = keyof typeof commandEnv;

/** Names reserved for later specs (planning sheet P3: Electric). */
export const reservedEnv = ["ELECTRIC_URL", "ELECTRIC_SECRET"] as const;

type Reserved = { [K in (typeof reservedEnv)[number]]?: string };

export type EnvFor<C extends Command> = Pick<FullEnv, (typeof commandEnv)[C][number]> & Reserved;

/** The environment of `serve`, the web server. */
export type Env = EnvFor<"serve">;

export type EnvResult<C extends Command = "serve"> =
  | { ok: true; env: EnvFor<C> }
  | { ok: false; errors: string[] };

/** Validates the names `command` uses, collecting every error rather than stopping at one. */
export function parseEnvFor<C extends Command>(
  command: C,
  source: Readonly<Record<string, string | undefined>>,
): EnvResult<C> {
  const errors: string[] = [];
  const parsed: Record<string, unknown> = {};
  for (const name of commandEnv[command]) {
    const variable: Variable<unknown> = variables[name];
    let raw = source[name];
    if (variable.kind === "default") raw ??= variable.default;
    if (raw === undefined || (raw === "" && variable.kind !== "default")) {
      if (variable.kind === "required") errors.push(`${name}: is required`);
      continue;
    }
    const result = variable.parse(raw);
    if (!result.ok) errors.push(`${name}: ${result.error}`);
    else if (result.value !== undefined) parsed[name] = result.value;
  }
  for (const name of reservedEnv) {
    const value = source[name];
    if (value !== undefined) parsed[name] = value;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, env: parsed as EnvFor<C> };
}

/** The environment of `serve`. */
export function parseEnv(source: Readonly<Record<string, string | undefined>>): EnvResult {
  return parseEnvFor("serve", source);
}
