import type { ComponentProps, ReactNode } from "react";
import { ArrowRightIcon } from "@/components/icons";
import { PageContainer } from "@/components/page";
import { SiteLink } from "@/components/site-link";
import { Badge } from "@/components/ui/badge";
import { useViewer } from "@/components/viewer";
import {
  type ContentMeta,
  type InitiativeStatus,
  isInitiativeMeta,
  type MDXComponents,
  type MDXContent,
} from "@/lib/content";
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
      <p
        data-demo="none"
        className="not-prose rounded-lg border border-dashed px-4 py-3 text-muted-foreground text-sm"
      >
        No demo is available yet.
      </p>
    );
  }
  return (
    <p data-demo="link" className="not-prose flex flex-wrap items-center gap-x-4 gap-y-2">
      <SiteLink
        href={href}
        className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 font-medium text-primary-foreground text-sm no-underline transition-colors hover:bg-primary/90"
      >
        {children ?? "Open the demo"}
        <ArrowRightIcon className="size-3.5" />
      </SiteLink>
      {viewer ? null : (
        <span data-demo-sign-in className="text-muted-foreground text-sm">
          The demo needs sign-in with a Linear account of the workspace.
        </span>
      )}
    </p>
  );
}

/** A note set apart from the prose. */
export function Callout({ title, children }: Readonly<{ title?: string; children: ReactNode }>) {
  return (
    <aside
      data-callout
      className="not-prose my-6 rounded-lg border border-l-2 border-l-brand bg-muted px-4 py-3 text-sm leading-6"
    >
      {title ? <p className="mb-1 font-medium text-foreground">{title}</p> : null}
      <div className="space-y-2 text-muted-foreground [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-4">
        {children}
      </div>
    </aside>
  );
}

/** The fixed set of site components content files can use (CONTENT-R9). */
export const contentComponents = { DemoLink, Callout } satisfies MDXComponents;

/** What content renders with: the site components, and links between pages that go
 * through the router (CONTENT-R21). */
export const mdxComponents = {
  ...contentComponents,
  a: ({ href = "", ...props }: ComponentProps<"a">) => <SiteLink href={href} {...props} />,
} satisfies MDXComponents;

/** An initiative's status label, shown under its page title (CONTENT-R12). */
export function StatusLabel({ status }: Readonly<{ status: InitiativeStatus }>) {
  return (
    <p data-initiative-status className="not-prose">
      <span className="sr-only">Status: </span>
      <Badge variant="secondary">{status}</Badge>
    </p>
  );
}

/**
 * One content page: the title from `meta`, the status label when `meta` is an
 * initiative's (CONTENT-R12), then the file in the shared prose style.
 */
export function ContentPage({
  meta,
  Content,
}: Readonly<{ meta: ContentMeta; Content: MDXContent }>) {
  return (
    <PageContainer>
      <article className="prose">
        <h1>{meta.title}</h1>
        {isInitiativeMeta(meta) ? <StatusLabel status={meta.status} /> : null}
        <Content components={mdxComponents} />
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
