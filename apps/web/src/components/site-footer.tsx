import { buildInfo, shortCommit } from "@/server/build-info";
import { site } from "@/site";

// Footer shared by every page: repository link and deployed build (SEED-R17, SEED-R21).
export function SiteFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-2 border-t px-6 py-6 text-muted-foreground text-sm">
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
