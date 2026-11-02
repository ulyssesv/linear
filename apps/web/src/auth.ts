// Sign-in vocabulary shared by the server handlers and the pages (MIRROR-R15, MIRROR-R16).
// Isomorphic: no secrets, no server imports.

export const signInPath = "/sign-in";
export const signInStartPath = "/auth/linear/sign-in";
export const signOutPath = "/auth/sign-out";
export const sheetsPath = "/sheets";

/** Why a sign-in did not produce a session; shown on the sign-in page. */
export const signInErrors = {
  "not-in-workspace":
    "Your Linear account is not a member of the workspace this site reads, so it cannot " +
    "sign in here.",
  guest:
    "Guest accounts in the workspace cannot sign in here, because the sheets show every " +
    "public team. Ask a workspace admin for membership.",
  "not-allowed":
    "Your Linear account is in the workspace but not on this site's sign-in allowlist. " +
    "Ask the site owner to add your email.",
  denied: "Sign-in was cancelled in Linear.",
  state: "That sign-in attempt expired or did not start in this browser. Try again.",
  failed: "Linear could not complete the sign-in. Try again in a moment.",
} as const;

export type SignInError = keyof typeof signInErrors;

export function isSignInError(value: unknown): value is SignInError {
  return typeof value === "string" && Object.hasOwn(signInErrors, value);
}

/**
 * Demo routes, where sign-in is required (MIRROR-R15). Every other page is public
 * (CONTENT-R2), so signing out can return to it (CONTENT-R4).
 */
export const demoPaths: readonly string[] = [sheetsPath];

/** Whether `path` is a demo route or under one. */
export function isDemoPath(path: string): boolean {
  return demoPaths.some(
    (demo) => path.startsWith(demo) && /^(?:[/?#]|$)/.test(path.slice(demo.length)),
  );
}

/**
 * Where to go after signing in or out: a same-origin path from the request, or `/`.
 * Absolute and protocol-relative URLs, backslashes, control characters and paths over
 * 512 characters are refused, so the parameter cannot become an open redirect
 * (CONTENT-R5).
 */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  const ok =
    raw.startsWith("/") &&
    !raw.includes("\\") &&
    !raw.includes("//") &&
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
    !/[\u0000-\u001f\u007f]/.test(raw) &&
    raw.length <= 512;
  return ok ? raw : "/";
}

/** The sign-in page for a visitor on `here`, returning there afterwards (CONTENT-R4). */
export function signInHref(here: string): string {
  const next = safeNext(here);
  if (next === "/" || next.startsWith(signInPath)) return signInPath;
  return `${signInPath}?next=${encodeURIComponent(next)}`;
}

/** Where signing out from `from` lands: back there when it is public, else `/` (CONTENT-R4). */
export function signOutTarget(from: unknown): string {
  const next = safeNext(from);
  return isDemoPath(next) ? "/" : next;
}
