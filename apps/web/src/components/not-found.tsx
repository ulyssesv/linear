import { PageContainer } from "@/components/page";

// Rendered for any path that matches no route (SEED-R29), inside the site shell.
export function NotFound() {
  return (
    <PageContainer className="space-y-4">
      <p className="font-mono text-muted-foreground text-xs">404</p>
      <h1 className="font-semibold text-3xl tracking-[-0.022em] sm:text-4xl">Page not found</h1>
      <p className="text-muted-foreground">There is nothing at this address.</p>
      <a href="/" className="inline-block text-brand text-sm hover:underline underline-offset-4">
        Back to the home page
      </a>
    </PageContainer>
  );
}
