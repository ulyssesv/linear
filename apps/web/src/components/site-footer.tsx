import { buildInfo, shortCommit } from "@/server/build-info";
import { site } from "@/site";

// Footer shared by every page: repository link and deployed build (SEED-R17, SEED-R21).
export function SiteFooter() {
  return (
    <footer className="mt-12 flex flex-wrap items-center justify-between gap-2 border-t pt-6 text-muted-foreground text-sm">
      <a href={site.repository} className="underline underline-offset-4 hover:text-foreground">
        Source on GitHub
      </a>
      <span>
        Version <span data-testid="version">{buildInfo.version}</span> · commit{" "}
        <span data-testid="commit">{shortCommit(buildInfo.commit)}</span>
      </span>
    </footer>
  );
}
