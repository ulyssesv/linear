// Content pages are MDX files under apps/web/content/ (CONTENT-R8). Each one compiles to a
// component and exports `meta` with at least a title and a description.
declare module "*.mdx" {
  import type { ContentMeta, MDXContent } from "@/lib/content";

  export const meta: ContentMeta;
  const Content: MDXContent;
  export default Content;
}
