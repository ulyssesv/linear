// The polling loop behind an open sheet's freshness (MIRROR-R24), apart from React so it
// can be tested with fake timers.
//
// - One request at a time; the next is scheduled `intervalMs` after the previous answer,
//   so a slow server is never stacked with requests.
// - Only while the page is visible: a hidden tab stops asking, and a tab that becomes
//   visible asks at once, then resumes the interval.
// - `onResult` returning false stops the loop for good (an expired session).
// - A failure is reported and the loop carries on at the same pace.

export type VisibilitySource = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;

export type PollerOptions<T> = {
  intervalMs: number;
  poll: () => Promise<T>;
  /** Return false to stop polling. */
  onResult: (result: T) => boolean | undefined;
  onError: (error: unknown) => void;
  visibility: VisibilitySource;
};

/** Starts polling; the returned function stops it. */
export function startPolling<T>(options: PollerOptions<T>): () => void {
  const { intervalMs, poll, onResult, onError, visibility } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let stopped = false;

  const visible = () => visibility.visibilityState === "visible";

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clear();
    if (!stopped && visible()) timer = setTimeout(tick, intervalMs);
  };

  async function tick() {
    timer = null;
    if (stopped || inFlight || !visible()) return;
    inFlight = true;
    try {
      const result = await poll();
      if (!stopped && onResult(result) === false) stop();
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      inFlight = false;
      schedule();
    }
  }

  const onVisibilityChange = () => {
    if (!visible()) clear();
    else if (timer === null && !inFlight) void tick();
  };

  function stop() {
    stopped = true;
    clear();
    visibility.removeEventListener("visibilitychange", onVisibilityChange);
  }

  visibility.addEventListener("visibilitychange", onVisibilityChange);
  schedule();
  return stop;
}
