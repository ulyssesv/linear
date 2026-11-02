import { createFileRoute } from "@tanstack/react-router";
import { ContentPage, contentHead } from "@/components/content";
import Content, { meta } from "../../content/ai-sdlc.mdx";

// Public content page (CONTENT-R1, CONTENT-R2); its copy is content/ai-sdlc.mdx.
export const Route = createFileRoute("/ai-sdlc")({
  head: contentHead(meta),
  component: () => <ContentPage meta={meta} Content={Content} />,
});
