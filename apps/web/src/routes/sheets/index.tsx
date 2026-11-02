import { createFileRoute } from "@tanstack/react-router";
import { PageContainer } from "@/components/page";
import { site } from "@/site";

// Index of the sheets (MIRROR-R15). The sheets themselves arrive with MIRROR T7.
export const Route = createFileRoute("/sheets/")({
  head: () => ({ meta: [{ title: `Planning sheet · ${site.name}` }] }),
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
    <PageContainer>
      <h1 className="font-semibold text-3xl tracking-tight">Planning sheet</h1>
      <div className="mt-8">
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
      </div>
    </PageContainer>
  );
}
