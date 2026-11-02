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
 * Where to go after signing in: a sheet path from the request, or the sheets index. Only
 * same-site paths under /sheets are accepted, so the parameter cannot become an open
 * redirect.
 */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string") return sheetsPath;
  const ok =
    /^\/sheets(?:[/?#]|$)/.test(raw) &&
    !raw.includes("\\") &&
    !raw.includes("//") &&
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
    !/[\u0000-\u001f\u007f]/.test(raw) &&
    raw.length <= 512;
  return ok ? raw : sheetsPath;
}
