export type RefreshTimers = {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

const defaultTimers: RefreshTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Coalesces bursts of refresh requests into one run per `delayMs` window and
 * never overlaps runs: a request that arrives while a run is in flight triggers
 * exactly one follow-up run, so the last change is always observed.
 */
export function createCoalescedRunner(
  task: () => Promise<void> | void,
  delayMs: number,
  timers: RefreshTimers = defaultTimers,
) {
  let timer: unknown;
  let running = false;
  let dirty = false;
  let cancelled = false;

  async function run(): Promise<void> {
    timer = undefined;
    if (cancelled) return;
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      await task();
    } finally {
      running = false;
      if (dirty && !cancelled) {
        dirty = false;
        schedule();
      }
    }
  }
  function schedule(): void {
    if (timer === undefined) timer = timers.set(() => void run(), delayMs);
  }
  return {
    request(): void {
      if (cancelled) return;
      if (running) dirty = true;
      else schedule();
    },
    cancel(): void {
      cancelled = true;
      if (timer !== undefined) timers.clear(timer);
      timer = undefined;
    },
  };
}

const slashes = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");

/**
 * Directories whose listings an event can change: the parent of every changed
 * path. An empty path list means "unknown", so everything is refreshed.
 */
export function directoriesToRefresh(
  changedPaths: readonly string[],
  cwd: string,
  loadedDirs: readonly string[],
): { root: boolean; dirs: string[] } {
  if (changedPaths.length === 0) return { root: true, dirs: [...loadedDirs] };
  const parents = new Set(changedPaths.map((path) => slashes(path).replace(/\/[^/]*$/, "")));
  const root = slashes(cwd);
  return {
    root: parents.has(root),
    dirs: loadedDirs.filter((dir) => parents.has(slashes(dir))),
  };
}

/** Collects items and delivers them together, preserving order and losing none. */
export function createBatcher<T>(
  deliver: (batch: T[]) => void,
  delayMs: number,
  timers: RefreshTimers = defaultTimers,
  options: { leading?: boolean } = {},
) {
  let queue: T[] = [];
  let timer: unknown;
  function flush(): void {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
    const batch = queue;
    queue = [];
    if (batch.length > 0) deliver(batch);
  }
  return {
    push(item: T): void {
      queue.push(item);
      if (timer === undefined) {
        // The first item of a quiet period is delivered at once; later ones are batched.
        if (options.leading) {
          const batch = queue;
          queue = [];
          deliver(batch);
        }
        timer = timers.set(flush, delayMs);
      }
    },
    /** Drop queued items without delivering them (the caller already has them). */
    discard(): void {
      queue = [];
      if (timer !== undefined) timers.clear(timer);
      timer = undefined;
    },
    flush,
  };
}
