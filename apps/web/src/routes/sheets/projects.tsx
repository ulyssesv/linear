import { createFileRoute } from "@tanstack/react-router";
import { getProjectsSheet } from "@/server/sheets/functions";
import { preloadGrid } from "@/sheets/grid/load";
import { SheetPlaceholder } from "@/sheets/sheet-frame";
import { SheetPage } from "@/sheets/sheet-page";

// The projects sheet (MIRROR-R18, MIRROR-R19). Client-only (MIRROR-R23): the server renders
// the placeholder; the /sheets layout guard still runs on the server first. The grid's
// chunk loads beside the data, and the placeholder goes as soon as both are in rather than
// after the router's default half-second minimum (MIRROR-R25).
export const Route = createFileRoute("/sheets/projects")({
  ssr: false,
  head: () => ({ meta: [{ title: "Projects · linear.sesv.co" }] }),
  loader: () => {
    preloadGrid();
    return getProjectsSheet();
  },
  pendingMinMs: 0,
  pendingComponent: () => <SheetPlaceholder kind="projects" />,
  component: ProjectsSheet,
});

function ProjectsSheet() {
  return <SheetPage view={Route.useLoaderData()} />;
}
