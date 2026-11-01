import { createFileRoute } from "@tanstack/react-router";
import { buildInfo } from "@/build-info";
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

export const Route = createFileRoute("/")({
  component: Landing,
});

export function Landing() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-6 py-12">
      <header className="space-y-4">
        <h1 className="font-semibold text-3xl tracking-tight">{site.name}</h1>
        <p className="max-w-2xl text-muted-foreground leading-relaxed">{site.purpose}</p>
      </header>

      <main className="mt-10 flex-1">
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
      </main>

      <footer className="mt-12 flex flex-wrap items-center justify-between gap-2 border-t pt-6 text-muted-foreground text-sm">
        <a href={site.repository} className="underline underline-offset-4 hover:text-foreground">
          Source on GitHub
        </a>
        <span>
          Version <span data-testid="version">{buildInfo.version}</span> · commit{" "}
          <span data-testid="commit">{buildInfo.commit}</span>
        </span>
      </footer>
    </div>
  );
}
