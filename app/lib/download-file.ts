/** One file of a bulk run, with its retry policy. */
import {
  BACKOFF_MS,
  MAX_RATE_RETRIES,
  requestTokens,
  retryAfterMs,
  RETRIES,
} from "./download-net";
import type { DlVariant, DownloadDeps, Token, Waiter } from "./download-net";

export type FetchedFile = { token: Token; res: Response | null };

/** What the file fetcher needs of a bulk run. */
export type FileFetchRun = {
  opts: {
    slug: string;
    variant: DlVariant;
    deps?: DownloadDeps;
    signal?: AbortSignal;
  };
  fetchFn: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  waiter: Waiter;
};

/** One 429 pause shared by all workers of a run: the first to hit it waits, the rest queue behind it. */
function createSharedPause(waiter: Waiter) {
  let pause: Promise<void> | null = null;
  return {
    get pending() {
      return pause;
    },
    /** Starts the shared wait unless one is running; false when the run's wait budget is spent. */
    start(ms: number): boolean {
      if (!pause) {
        if (!waiter.canWait(ms)) return false;
        pause = waiter.wait(ms).finally(() => {
          pause = null;
        });
      }
      return true;
    },
  };
}

/**
 * Asks for a fresh token for a photo whose queued token expired. Deliberately
 * not `async`: it returns the request's own promise, so awaiting it costs the
 * same microtask ticks as the inline call (the bulk golden pins the workers'
 * interleaving).
 */
const requestFreshToken = (run: FileFetchRun, bulkId: string, token: Token) =>
  requestTokens(
    run.opts.slug,
    [token.photoId],
    run.opts.variant,
    bulkId,
    run.opts.deps,
    run.opts.signal,
    run.waiter,
  );

/**
 * One file with the run's retry policy: network/5xx retried with backoff, a
 * 410 refreshed once per photo, a 429 waited out (one shared pause for all
 * workers), 403/404 final. `res` is null when the file failed or aborted.
 */
export function createFileFetcher(
  run: FileFetchRun,
  bulkId: string,
): (first: Token) => Promise<FetchedFile> {
  const { signal } = run.opts;
  const refreshed = new Set<string>();
  const shared = createSharedPause(run.waiter);

  return async function fetchFile(first) {
    let token = first;
    let tries = 0;
    let rateTries = 0;
    for (;;) {
      if (signal?.aborted) return { token, res: null };
      while (shared.pending) await shared.pending;
      let res: Response | null = null;
      try {
        res = await run.fetchFn(token.url, { signal });
      } catch {
        if (signal?.aborted) return { token, res: null };
      }
      if (res?.ok) return { token, res };
      if (res) {
        if (res.status === 410 && !refreshed.has(token.photoId)) {
          // The queued token expired: ask for a fresh one, once per photo.
          refreshed.add(token.photoId);
          try {
            const r = await requestFreshToken(run, bulkId, token);
            const fresh = r.tokens.find((t) => t.photoId === token.photoId);
            if (fresh) {
              token = fresh;
              continue;
            }
          } catch {
            /* fall through to failed */
          }
          return { token, res: null };
        }
        if (res.status === 429) {
          if (rateTries >= MAX_RATE_RETRIES) return { token, res: null };
          if (
            !shared.start(
              retryAfterMs(res.headers.get("Retry-After"), rateTries++),
            )
          )
            return { token, res: null };
          continue;
        }
        // Expired / revoked / missing: retrying cannot help.
        if ([403, 404, 410].includes(res.status)) return { token, res: null };
      }
      if (tries >= RETRIES) return { token, res: null };
      await run.sleep(BACKOFF_MS * 2 ** tries++);
    }
  };
}
