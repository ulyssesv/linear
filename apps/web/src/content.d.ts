// Content pages are MDX files under apps/web/content/ (CONTENT-R8). Each one compiles to a
// component and exports `meta` with at least a title and a description.
//
// about.mdx also exports the excerpt the landing page shows (CONTENT-R14), and this-site.mdx
// the summary of its section (CONTENT-R11). Their narrower patterns come first: TypeScript picks the first of equally specific patterns.
declare module "*/about.mdx" {
  import type { ContentMeta, MDXContent } from "@/lib/content";

  export const meta: ContentMeta;
  /** One or two sentences about the author, shown on /about and on the landing page. */
  export const excerpt: string;
  const Content: MDXContent;
  export default Content;
}

declare module "*/this-site.mdx" {
  import type { ContentMeta, MDXContent } from "@/lib/content";

  export const meta: ContentMeta;
  /** A few sentences about how the site is made, shown on the landing page. */
  export const summary: string;
  const Content: MDXContent;
  export default Content;
}

declare module "*.mdx" {
  import type { ContentMeta, MDXContent } from "@/lib/content";

  export const meta: ContentMeta;
  const Content: MDXContent;
  export default Content;
}
