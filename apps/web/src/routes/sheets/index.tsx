import { createFileRoute } from "@tanstack/react-router";
import { SiteFooter } from "@/components/site-footer";

// Index of the sheets (MIRROR-R15): links to the projects and initiatives sheets.
export const Route = createFileRoute("/sheets/")({
  component: SheetsIndex,
});

const sheets = [
  { href: "/sheets/projects", title: "Projects", summary: "Every project of the public teams." },
  {
    href: "/sheets/initiatives",
    title: "Initiatives",
    summary: "Every initiative of the workspace.",
  },
];

function SheetsIndex() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-6 py-12">
      <h1 className="font-semibold text-3xl tracking-tight">Planning sheet</h1>
      <main className="mt-8 flex-1">
        <ul className="space-y-4">
          {sheets.map((sheet) => (
            <li key={sheet.href}>
              <a href={sheet.href} className="font-medium underline underline-offset-4">
                {sheet.title}
              </a>
              <p className="text-muted-foreground text-sm">{sheet.summary}</p>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
