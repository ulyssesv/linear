import { buildInfo, shortCommit } from "@/server/build-info";
import { site } from "@/site";

/** The footer's statement of independence from Linear (CONTENT-R17). */
export const disclaimer = "An independent project, not affiliated with or endorsed by Linear.";

// Footer shared by every page: the disclaimer next to the repository link and the deployed
// build (SEED-R17, SEED-R21, CONTENT-R17).
export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-8 text-[13px] text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
        <p data-testid="disclaimer" className="max-w-md">
          {disclaimer}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a href={site.repository} className="hover:text-foreground">
            Source on GitHub
          </a>
          <span aria-hidden="true" className="hidden sm:inline">
            ·
          </span>
          <span className="font-mono text-xs">
            Version <span data-testid="version">{buildInfo.version}</span> · commit{" "}
            <span data-testid="commit">{shortCommit(buildInfo.commit)}</span>
          </span>
        </p>
      </div>
    </footer>
  );
}
