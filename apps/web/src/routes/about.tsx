import { createFileRoute } from "@tanstack/react-router";
import { ContentPage, contentHead, Figure } from "@/components/content";
import Content, { meta, photoCaption } from "../../content/about.mdx";

// Public content page (CONTENT-R1, CONTENT-R2); its copy is content/about.mdx. The author's
// photo sits beside it with its caption from the same file, on the first screen, so it
// loads eagerly (CONTENT-R14, CONTENT-R22).
export const Route = createFileRoute("/about")({
  head: contentHead(meta),
  component: () => (
    <ContentPage
      meta={meta}
      Content={Content}
      aside={
        <Figure
          image="me"
          caption={photoCaption}
          sizes="(min-width: 48rem) 11rem, 7rem"
          eager
          className="[&_figcaption]:whitespace-nowrap"
        />
      }
    />
  ),
});
