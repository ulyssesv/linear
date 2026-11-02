// Keeps an open sheet current (MIRROR-R24): polls getSheetChanges every few seconds while
// the tab is visible and merges what changed into the model, in place. Read-only: the poll
// is a GET server function and nothing is stored in the browser (MIRROR-R20).
import { useEffect, useRef, useState } from "react";
import { getSheetChanges } from "@/server/sheets/functions";
import { applyChange, type SheetFreshness, type SheetView } from "./freshness.ts";
import type { SheetModel } from "./model.ts";
import { startPolling } from "./poller.ts";

/**
 * How often an open, visible sheet asks whether the mirror moved. With the server's apply
 * time as the start, a change shows within this interval plus one round trip and a render,
 * well inside the ten seconds of MIRROR-R24.
 */
export const pollIntervalMs = 3_000;

/** live: the last poll answered; failing: it did not, retrying; signed-out: stopped. */
export type FreshnessState = "live" | "failing" | "signed-out";

export function useSheetFreshness(view: SheetView): {
  model: SheetModel;
  freshness: SheetFreshness;
  state: FreshnessState;
} {
  const [model, setModel] = useState(view.model);
  const [freshness, setFreshness] = useState(view.freshness);
  const [state, setState] = useState<FreshnessState>("live");
  const cursor = useRef(view.freshness);
  const kind = view.model.kind;

  useEffect(
    () =>
      startPolling({
        intervalMs: pollIntervalMs,
        visibility: document,
        poll: () =>
          getSheetChanges({
            data: { kind, version: cursor.current.version, bulkRun: cursor.current.bulkRun },
          }),
        onResult: (result) => {
          if (!result.signedIn) {
            setState("signed-out");
            return false;
          }
          cursor.current = result.freshness;
          setFreshness(result.freshness);
          const { change } = result;
          if (change) setModel((current) => applyChange(current, change));
          setState("live");
          return true;
        },
        onError: () => setState("failing"),
      }),
    [kind],
  );

  return { model, freshness, state };
}
