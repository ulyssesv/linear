import { createFileRoute } from "@tanstack/react-router";
import { isSignInError, type SignInError, safeNext, signInErrors, signInStartPath } from "@/auth";
import { PageContainer } from "@/components/page";
import { site } from "@/site";

// The public sign-in page (MIRROR-R15, MIRROR-R16): one button to Linear, and the reason
// when the last attempt was refused. Server-rendered, works without JavaScript. `next` is
// the page to return to afterwards, any same-origin path (CONTENT-R4, CONTENT-R5).
type Search = { error?: SignInError; next?: string };

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    error: isSignInError(search.error) ? search.error : undefined,
    next: typeof search.next === "string" ? safeNext(search.next) : undefined,
  }),
  head: () => ({
    meta: [
      { title: `Sign in · ${site.name}` },
      {
        name: "description",
        content: "Sign in with a Linear account of the workspace to open the demos.",
      },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const { error, next } = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const start = next ? `${signInStartPath}?next=${encodeURIComponent(next)}` : signInStartPath;
  return (
    <PageContainer>
      <div className="max-w-xl space-y-6">
        <h1 className="font-semibold text-3xl tracking-tight">Sign in</h1>
        <p className="text-muted-foreground leading-relaxed">
          The demos read the Linear workspace this site is installed in. Members of that workspace
          sign in with their Linear account; every other page is open to anyone.
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
            <a href={next ?? "/"} className="underline underline-offset-4">
              Continue
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
      </div>
    </PageContainer>
  );
}
