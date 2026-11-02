import { createFileRoute } from "@tanstack/react-router";
import { ContentPage, contentHead } from "@/components/content";
import Content, { meta } from "../../content/metrics-rollup.mdx";

// Public content page (CONTENT-R1, CONTENT-R2); its copy is content/metrics-rollup.mdx.
export const Route = createFileRoute("/metrics-rollup")({
  head: contentHead(meta),
  component: () => <ContentPage meta={meta} Content={Content} />,
});
