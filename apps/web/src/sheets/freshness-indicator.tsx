// When the mirror behind an open sheet last changed (MIRROR-R24), relative with the
// absolute time on hover, and what the page knows about its own freshness: a failing poll
// shows a quiet warning, an expired session a link to sign in again.
import { useEffect, useState } from "react";
import { signInPath } from "@/auth";
import { absoluteTime, relativeTime, type SheetFreshness } from "./freshness.ts";
import type { SheetKind } from "./model.ts";
import type { FreshnessState } from "./use-sheet-freshness.ts";

/** The current time, ticking every `everyMs`, so relative times stay true. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

export function FreshnessIndicator({
  kind,
  freshness,
  state,
}: {
  kind: SheetKind;
  freshness: SheetFreshness;
  state: FreshnessState;
}) {
  const now = useNow(10_000);
  const at = freshness.lastChangeAt;
  return (
    <p
      data-testid="sheet-freshness"
      data-state={state}
      data-version={freshness.version}
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-sm"
    >
      {at ? (
        <span>
          Updated{" "}
          <time dateTime={at} title={absoluteTime(at)}>
            {relativeTime(at, Math.max(now, Date.now()))}
          </time>
        </span>
      ) : (
        <span>No changes recorded yet</span>
      )}
      {state === "failing" ? (
        <span className="text-amber-700 dark:text-amber-400">
          · Can't reach the server; retrying
        </span>
      ) : null}
      {state === "signed-out" ? (
        <span className="text-foreground">
          · Your session ended.{" "}
          <a
            className="underline underline-offset-4"
            href={`${signInPath}?next=${encodeURIComponent(`/sheets/${kind}`)}`}
          >
            Sign in again
          </a>{" "}
          to keep this sheet current.
        </span>
      ) : null}
    </p>
  );
}
