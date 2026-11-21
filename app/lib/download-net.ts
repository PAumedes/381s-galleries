/** Transport shared by single and bulk downloads: types, token requests, 429 waiting, abort helpers. */
import { EmailRequiredError } from "../components/use-visitor";
import type { DownloadSize } from "./constants";

export type DlVariant = DownloadSize;
export type BulkScope = "all" | "set" | "favorites";
export type DownloadErrorCode =
  | "variant_disabled"
  | "bulk_disabled"
  | "rate_limited"
  | "unavailable"
  | "http"
  | "network";

/** A typed download failure (the email gate case is `EmailRequiredError`). */
export class DownloadError extends Error {
  constructor(
    readonly code: DownloadErrorCode,
    readonly status?: number,
  ) {
    super(code);
  }
}

export type Token = {
  photoId: string;
  url: string;
  filename: string;
};
export type TokenResult = {
  tokens: Token[];
  missing: string[];
  unavailable: string[];
};

export type SavePicker = (opts?: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;

export type DownloadDeps = {
  fetch?: typeof globalThis.fetch;
  showSaveFilePicker?: SavePicker;
  saveBlob?: (blob: Blob, filename: string) => void;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
};

export const BATCH_SIZE = 50;
export const CONCURRENCY = 3;
export const RETRIES = 2;
export const BACKOFF_MS = 500;
const base = (slug: string) => `/api/g/${encodeURIComponent(slug)}`;
export const doFetch = (deps?: DownloadDeps) =>
  deps?.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));

/**
 * POST a JSON body. With `retry` (bulk runs only) a 429 waits `Retry-After`
 * (capped) and tries again, up to MAX_RATE_RETRIES times, instead of failing
 * a run that is already under way.
 */
export async function post(
  slug: string,
  path: string,
  body: unknown,
  deps?: DownloadDeps,
  signal?: AbortSignal,
  waiter?: Waiter,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await postOnce(slug, path, body, deps, signal);
    } catch (err) {
      if (
        !waiter ||
        !(err instanceof RateLimitedError) ||
        attempt >= MAX_RATE_RETRIES
      )
        throw err;
      const wait = retryAfterMs(err.retryAfter, attempt);
      if (!waiter.canWait(wait)) throw err;
      await waiter.wait(wait);
      if (signal?.aborted) throw abortError();
    }
  }
}

/**
 * The run's 429 waits: every sleep ends at once when the signal aborts, the
 * total waiting is budgeted, and the remaining seconds are reported while waiting.
 */
export type Waiter = {
  canWait: (ms: number) => boolean;
  wait: (ms: number) => Promise<void>;
};

export function createWaiter(
  deps: DownloadDeps | undefined,
  signal: AbortSignal | undefined,
  onWaiting?: (seconds: number | null) => void,
): Waiter {
  let budget = MAX_TOTAL_WAIT_MS;
  let active = 0;
  let until = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = () =>
    onWaiting?.(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
  return {
    canWait: (ms) => ms <= budget,
    async wait(ms) {
      budget -= ms;
      until = Math.max(until, Date.now() + ms);
      if (active++ === 0 && onWaiting) timer = setInterval(tick, 1000);
      tick();
      try {
        await abortableSleep(deps?.sleep ?? defaultSleep, ms, signal);
      } finally {
        if (--active === 0) {
          clearInterval(timer);
          onWaiting?.(null);
        }
      }
    },
  };
}

/** `sleep(ms)` that resolves immediately when `signal` aborts. */
export function abortableSleep(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      signal?.removeEventListener("abort", done);
      resolve();
    };
    signal?.addEventListener("abort", done, { once: true });
    sleep(ms).then(done, done);
  });
}

class RateLimitedError extends DownloadError {
  constructor(readonly retryAfter: string | null) {
    super("rate_limited", 429);
  }
}

export const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

async function postOnce(
  slug: string,
  path: string,
  body: unknown,
  deps?: DownloadDeps,
  signal?: AbortSignal,
): Promise<Response> {
  let res: Response;
  try {
    res = await doFetch(deps)(`${base(slug)}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new DownloadError("network");
  }
  if (res.ok) return res;
  const err = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (res.status === 403 && err?.error === "email_required")
    throw new EmailRequiredError();
  if (res.status === 403 && err?.error === "variant_disabled")
    throw new DownloadError("variant_disabled", 403);
  if (res.status === 403 && err?.error === "bulk_disabled")
    throw new DownloadError("bulk_disabled", 403);
  if (res.status === 429)
    throw new RateLimitedError(res.headers.get("Retry-After"));
  throw new DownloadError("http", res.status);
}

export async function requestTokens(
  slug: string,
  photoIds: string[],
  variant: DlVariant,
  bulkId?: string,
  deps?: DownloadDeps,
  signal?: AbortSignal,
  waiter?: Waiter,
): Promise<TokenResult> {
  const res = await post(
    slug,
    "download-tokens",
    { photoIds, variant, ...(bulkId ? { bulkId } : {}) },
    deps,
    signal,
    bulkId ? (waiter ?? createWaiter(deps, signal)) : undefined,
  );
  return (await res.json()) as TokenResult;
}

export function clickAnchor(href: string, filename?: string) {
  const a = document.createElement("a");
  a.href = href;
  if (filename !== undefined) a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
  }
}

export function currentPicker(): SavePicker | undefined {
  const w = typeof window === "undefined" ? undefined : window;
  const fn = (w as unknown as { showSaveFilePicker?: SavePicker } | undefined)
    ?.showSaveFilePicker;
  return fn ? fn.bind(w) : undefined;
}

export const abortError = () => new DOMException("Aborted", "AbortError");
export const isAbort = (e: unknown) =>
  e instanceof DOMException && e.name === "AbortError";

export const MAX_RATE_RETRIES = 5;
/** One rate-limit window of /dl and the token endpoints. */
export const MAX_RETRY_AFTER_MS = 600_000;
/** All 429 waiting of one run. */
export const MAX_TOTAL_WAIT_MS = 12 * 60_000;

/** Wait before retrying a 429: the `Retry-After` header (seconds or date), else exponential; capped. */
export function retryAfterMs(header: string | null, attempt: number): number {
  const h = header?.trim();
  let ms = NaN;
  if (h) {
    if (/^\d+(\.\d+)?$/.test(h)) ms = Number(h) * 1000;
    else {
      const at = Date.parse(h);
      if (!Number.isNaN(at)) ms = at - Date.now();
    }
  }
  if (Number.isNaN(ms)) ms = 1000 * 2 ** attempt;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
}
