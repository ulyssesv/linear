import { createFileRoute } from "@tanstack/react-router";
import { ContentPage, contentHead } from "@/components/content";
import Content, { meta } from "../../content/about.mdx";

// Public content page (CONTENT-R1, CONTENT-R2); its copy is content/about.mdx.
export const Route = createFileRoute("/about")({
  head: contentHead(meta),
  component: () => <ContentPage meta={meta} Content={Content} />,
});
