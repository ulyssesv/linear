import type { ReactNode } from "react";
import { PageContainer } from "@/components/page";
import { useViewer } from "@/components/viewer";
import type { ContentMeta, MDXComponents, MDXContent } from "@/lib/content";
import { site } from "@/site";

// The layout and components of content pages (CONTENT-R8, CONTENT-R9). Copy lives in
// apps/web/content/*.mdx; a route renders its file with <ContentPage> and takes its
// <title> and description from the file's `meta` with contentHead (CONTENT-R7).

/**
 * A link into a demo, or a note that there is none yet (CONTENT-R12). Anonymous visitors
 * are told that the demo needs sign-in with a Linear account of the workspace.
 */
export function DemoLink({ href, children }: Readonly<{ href?: string; children?: ReactNode }>) {
  const viewer = useViewer();
  if (!href) {
    return (
      <p data-demo="none" className="text-muted-foreground">
        No demo is available yet.
      </p>
    );
  }
  return (
    <p data-demo="link">
      <a href={href} className="font-medium">
        {children ?? "Open the demo"}
      </a>
      {viewer ? null : (
        <span data-demo-sign-in className="block text-muted-foreground text-sm">
          The demo needs sign-in with a Linear account of the workspace.
        </span>
      )}
    </p>
  );
}

/** A note set apart from the prose. */
export function Callout({ title, children }: Readonly<{ title?: string; children: ReactNode }>) {
  return (
    <aside data-callout className="not-prose my-6 rounded-md border bg-muted/40 px-4 py-3 text-sm">
      {title ? <p className="mb-1 font-medium">{title}</p> : null}
      <div className="space-y-2 text-muted-foreground [&_a]:underline">{children}</div>
    </aside>
  );
}

/** The fixed set of site components content files can use (CONTENT-R9). */
export const contentComponents = { DemoLink, Callout } satisfies MDXComponents;

/** One content page: the title from `meta`, then the file in the shared prose style. */
export function ContentPage({
  meta,
  Content,
}: Readonly<{ meta: ContentMeta; Content: MDXContent }>) {
  return (
    <PageContainer>
      <article className="prose">
        <h1>{meta.title}</h1>
        <Content components={contentComponents} />
      </article>
    </PageContainer>
  );
}

/** A route's head from a content file's `meta` (CONTENT-R7). */
export function contentHead(meta: ContentMeta) {
  return () => ({
    meta: [
      { title: `${meta.title} · ${site.name}` },
      { name: "description", content: meta.description },
    ],
  });
}
