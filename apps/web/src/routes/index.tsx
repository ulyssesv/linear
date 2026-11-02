import { createFileRoute } from "@tanstack/react-router";
import { PageContainer } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { proofsOfConcept, site } from "@/site";

// The landing page, moved into the site shell by CONTENT T1; CONTENT T3 rewrites it.
export const Route = createFileRoute("/")({
  component: Landing,
});

export function Landing() {
  return (
    <PageContainer>
      <div className="space-y-4">
        <h1 className="font-semibold text-3xl tracking-tight">{site.name}</h1>
        <p className="max-w-2xl text-muted-foreground leading-relaxed">{site.purpose}</p>
      </div>

      <section className="mt-10">
        <h2 className="sr-only">Proofs of concept</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {proofsOfConcept.map((poc) => (
            <li key={poc.key} data-poc={poc.key} className="flex">
              <Card className="flex-1">
                <CardHeader>
                  <CardTitle>
                    <h3>{poc.title}</h3>
                  </CardTitle>
                  <CardAction>
                    <Badge variant="secondary">{poc.status}</Badge>
                  </CardAction>
                  <CardDescription>{poc.summary}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  <a
                    href={poc.link.href}
                    className="text-sm underline underline-offset-4 hover:text-muted-foreground"
                  >
                    {poc.link.label}
                  </a>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
