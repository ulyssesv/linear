import { createFileRoute } from "@tanstack/react-router";
import { ContentPage, contentHead } from "@/components/content";
import Content, { meta } from "../../content/this-site.mdx";

// Public content page (CONTENT-R1, CONTENT-R2); its copy is content/this-site.mdx.
export const Route = createFileRoute("/this-site")({
  head: contentHead(meta),
  component: () => <ContentPage meta={meta} Content={Content} />,
});
