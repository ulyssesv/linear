import { createFileRoute } from "@tanstack/react-router";
import { getInitiativesSheet } from "@/server/sheets/functions";
import { SheetPage, SheetPlaceholder } from "@/sheets/sheet-page";

// The initiatives sheet (MIRROR-R18, MIRROR-R19). Client-only (MIRROR-R23): the server
// renders the placeholder; the /sheets layout guard still runs on the server first.
export const Route = createFileRoute("/sheets/initiatives")({
  ssr: false,
  head: () => ({ meta: [{ title: "Initiatives · linear.sesv.co" }] }),
  loader: () => getInitiativesSheet(),
  pendingComponent: () => <SheetPlaceholder kind="initiatives" />,
  component: InitiativesSheet,
});

function InitiativesSheet() {
  return <SheetPage model={Route.useLoaderData()} />;
}
