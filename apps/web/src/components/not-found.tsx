import { PageContainer } from "@/components/page";

// Rendered for any path that matches no route (SEED-R29), inside the site shell.
export function NotFound() {
  return (
    <PageContainer className="space-y-4">
      <h1 className="font-semibold text-3xl tracking-tight">Page not found</h1>
      <p className="text-muted-foreground">There is nothing at this address.</p>
      <a href="/" className="text-sm underline underline-offset-4 hover:text-muted-foreground">
        Back to the home page
      </a>
    </PageContainer>
  );
}
