import { createFileRoute } from "@tanstack/react-router";
import { ContentPage, contentHead } from "@/components/content";
import Content, { meta } from "../../content/planning-sheet.mdx";

// Public content page (CONTENT-R1, CONTENT-R2); its copy is content/planning-sheet.mdx.
export const Route = createFileRoute("/planning-sheet")({
  head: contentHead(meta),
  component: () => <ContentPage meta={meta} Content={Content} />,
});
