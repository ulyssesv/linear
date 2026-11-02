import { createFileRoute } from "@tanstack/react-router";
import {
  isSignInError,
  type SignInError,
  safeNext,
  sheetsPath,
  signInErrors,
  signInStartPath,
} from "@/auth";
import { SiteFooter } from "@/components/site-footer";

// The public sign-in page (MIRROR-R15, MIRROR-R16): one button to Linear, and the reason
// when the last attempt was refused. Server-rendered, works without JavaScript.
type Search = { error?: SignInError; next?: string };

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    error: isSignInError(search.error) ? search.error : undefined,
    next: typeof search.next === "string" ? safeNext(search.next) : undefined,
  }),
  head: () => ({ meta: [{ title: "Sign in · linear.sesv.co" }] }),
  component: SignIn,
});

function SignIn() {
  const { error, next } = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const start = next ? `${signInStartPath}?next=${encodeURIComponent(next)}` : signInStartPath;
  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-6 py-12">
      <h1 className="font-semibold text-3xl tracking-tight">Sign in</h1>
      <main className="mt-8 max-w-xl flex-1 space-y-6">
        <p className="text-muted-foreground leading-relaxed">
          The planning sheet reads the Linear workspace it is installed in. Members of that
          workspace sign in with their Linear account.
        </p>
        {error ? (
          <p
            role="alert"
            data-error={error}
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
          >
            {signInErrors[error]}
          </p>
        ) : null}
        {auth.user ? (
          <p>
            Signed in as {auth.user.name}.{" "}
            <a href={next ?? sheetsPath} className="underline underline-offset-4">
              Open the sheets
            </a>
          </p>
        ) : (
          <a
            href={start}
            className="inline-flex h-10 items-center rounded-md bg-primary px-5 font-medium text-primary-foreground text-sm hover:bg-primary/90"
          >
            Sign in with Linear
          </a>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
