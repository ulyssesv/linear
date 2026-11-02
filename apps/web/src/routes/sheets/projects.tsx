import { createFileRoute } from "@tanstack/react-router";
import { getProjectsSheet } from "@/server/sheets/functions";
import { SheetPage, SheetPlaceholder } from "@/sheets/sheet-page";

// The projects sheet (MIRROR-R18, MIRROR-R19). Client-only (MIRROR-R23): the server renders
// the placeholder; the /sheets layout guard still runs on the server first.
export const Route = createFileRoute("/sheets/projects")({
  ssr: false,
  head: () => ({ meta: [{ title: "Projects · linear.sesv.co" }] }),
  loader: () => getProjectsSheet(),
  pendingComponent: () => <SheetPlaceholder kind="projects" />,
  component: ProjectsSheet,
});

function ProjectsSheet() {
  return <SheetPage model={Route.useLoaderData()} />;
}
