import { createFileRoute } from "@tanstack/react-router";
import { contentHead, mdxComponents } from "@/components/content";
import { ArrowRightIcon } from "@/components/icons";
import { PageContainer } from "@/components/page";
import { SiteLink } from "@/components/site-link";
import { Badge } from "@/components/ui/badge";
import { type ContentMeta, isInitiativeMeta } from "@/lib/content";
import { type InitiativeKey, initiativePages } from "@/site";
import { excerpt } from "../../content/about.mdx";
import { meta as aiSdlc } from "../../content/ai-sdlc.mdx";
import Landing, { meta } from "../../content/landing.mdx";
import { meta as metricsRollup } from "../../content/metrics-rollup.mdx";
import { meta as planningSheet } from "../../content/planning-sheet.mdx";
import { summary } from "../../content/this-site.mdx";

// The landing page (CONTENT-R11): a hero with the title and the purpose, one card per
// initiative read from that initiative's own page, a section about this site with the
// summary from /this-site, and the author excerpt shared with /about (CONTENT-R14). Copy lives in content/landing.mdx and the files it names.
const initiativeMeta: Record<InitiativeKey, ContentMeta> = {
  "planning-sheet": planningSheet,
  "metrics-rollup": metricsRollup,
  "ai-sdlc": aiSdlc,
};

const cards = initiativePages.map((page) => {
  const pageMeta = initiativeMeta[page.key];
  return {
    ...page,
    title: pageMeta.title,
    summary: pageMeta.description,
    status: isInitiativeMeta(pageMeta) ? pageMeta.status : undefined,
  };
});

export const Route = createFileRoute("/")({
  head: contentHead(meta),
  component: LandingPage,
});

function MoreLink({ href, children }: Readonly<{ href: string; children: string }>) {
  return (
    <SiteLink
      href={href}
      className="group mt-4 inline-flex items-center gap-1.5 font-medium text-brand text-sm"
    >
      {children}
      <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
    </SiteLink>
  );
}

function LandingPage() {
  return (
    <PageContainer>
      <section className="max-w-2xl">
        <h1 className="font-semibold text-4xl tracking-[-0.03em] sm:text-5xl">{meta.title}</h1>
        <div data-purpose className="mt-5 space-y-3 text-lg text-muted-foreground leading-relaxed">
          <Landing components={mdxComponents} />
        </div>
      </section>

      <section aria-labelledby="ideas" className="mt-16">
        <h2 id="ideas" className="font-medium text-muted-foreground text-sm">
          Ideas &amp; Experiments
        </h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-3">
          {cards.map((card) => (
            <li key={card.key} data-initiative={card.key} className="flex">
              <SiteLink
                href={card.href}
                className="group flex flex-1 flex-col rounded-xl border bg-card p-5 transition-colors hover:border-foreground/20 hover:bg-accent"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-base tracking-[-0.01em]">{card.title}</h3>
                  {card.status ? (
                    <Badge data-initiative-status variant="secondary" className="mt-0.5">
                      <span className="sr-only">Status: </span>
                      {card.status}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-2 text-muted-foreground text-sm leading-6">{card.summary}</p>
                <span className="mt-auto inline-flex items-center gap-1.5 pt-6 font-medium text-brand text-sm">
                  Read more
                  <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </SiteLink>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-16 grid gap-10 border-t pt-12 md:grid-cols-2">
        <section aria-labelledby="this-site" data-section="this-site">
          <h2 id="this-site" className="font-semibold text-lg tracking-[-0.01em]">
            About this site
          </h2>
          <p data-summary className="mt-3 text-muted-foreground leading-7">
            {summary}
          </p>
          <MoreLink href="/this-site">How it is built</MoreLink>
        </section>
        <section aria-labelledby="about" data-section="about">
          <h2 id="about" className="font-semibold text-lg tracking-[-0.01em]">
            About me
          </h2>
          <p data-excerpt className="mt-3 text-muted-foreground leading-7">
            {excerpt}
          </p>
          <MoreLink href="/about">More about me</MoreLink>
        </section>
      </div>
    </PageContainer>
  );
}
