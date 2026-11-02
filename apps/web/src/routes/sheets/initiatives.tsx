import { createFileRoute } from "@tanstack/react-router";
import { getInitiativesSheet } from "@/server/sheets/functions";
import { preloadGrid } from "@/sheets/grid/load";
import { SheetPlaceholder } from "@/sheets/sheet-frame";
import { SheetPage } from "@/sheets/sheet-page";

// The initiatives sheet (MIRROR-R18, MIRROR-R19). Client-only (MIRROR-R23): the server
// renders the placeholder; the /sheets layout guard still runs on the server first. The
// grid's chunk loads beside the data, and the placeholder goes as soon as both are in
// rather than after the router's default half-second minimum (MIRROR-R25).
export const Route = createFileRoute("/sheets/initiatives")({
  ssr: false,
  head: () => ({ meta: [{ title: "Initiatives · linear.sesv.co" }] }),
  loader: () => {
    preloadGrid();
    return getInitiativesSheet();
  },
  pendingMinMs: 0,
  pendingComponent: () => <SheetPlaceholder kind="initiatives" />,
  component: InitiativesSheet,
});

function InitiativesSheet() {
  return <SheetPage view={Route.useLoaderData()} />;
}
