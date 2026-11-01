import { SiteFooter } from "@/components/site-footer";
import { site } from "@/site";

// Rendered for any path that matches no route (SEED-R29).
export function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-6 py-12">
      <header>
        <a href="/" className="font-semibold text-lg tracking-tight hover:text-muted-foreground">
          {site.name}
        </a>
      </header>

      <main className="mt-10 flex-1 space-y-4">
        <h1 className="font-semibold text-3xl tracking-tight">Page not found</h1>
        <p className="text-muted-foreground">There is nothing at this address.</p>
        <a href="/" className="text-sm underline underline-offset-4 hover:text-muted-foreground">
          Back to the home page
        </a>
      </main>

      <SiteFooter />
    </div>
  );
}
