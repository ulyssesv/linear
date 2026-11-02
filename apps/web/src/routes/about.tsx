import { createFileRoute } from "@tanstack/react-router";
import { ContentPage, contentHead } from "@/components/content";
import { Photo } from "@/components/photo";
import { images } from "@/images";
import Content, { meta } from "../../content/about.mdx";

// Public content page (CONTENT-R1, CONTENT-R2); its copy is content/about.mdx. The
// author's photo sits beside it, on the first screen, so it loads eagerly (CONTENT-R14,
// CONTENT-R22).
export const Route = createFileRoute("/about")({
  head: contentHead(meta),
  component: () => (
    <ContentPage
      meta={meta}
      Content={Content}
      aside={<Photo image={images.me} sizes="(min-width: 48rem) 11rem, 7rem" eager />}
    />
  ),
});
