import type { DownloadSize } from "./constants";
import { downloadZip } from "client-zip";

import { EmailRequiredError } from "../components/use-visitor";

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
const BACKOFF_MS = 500;
const LARGE_BYTES = 1.5 * 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const AVG_BYTES: Record<DlVariant, number> = {
  web: 1.2 * MB,
  highres: 3 * MB,
  ig: 0.6 * MB,
};

const base = (slug: string) => `/api/g/${encodeURIComponent(slug)}`;
const doFetch = (deps?: DownloadDeps) =>
  deps?.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));

/**
 * POST a JSON body. With `retry` (bulk runs only) a 429 waits `Retry-After`
 * (capped) and tries again, up to MAX_RATE_RETRIES times, instead of failing
 * a run that is already under way.
 */
async function post(
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
type Waiter = {
  canWait: (ms: number) => boolean;
  wait: (ms: number) => Promise<void>;
};

function createWaiter(
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
function abortableSleep(
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

const defaultSleep = (ms: number) =>
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

function clickAnchor(href: string, filename?: string) {
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

export async function downloadSingle(
  slug: string,
  photoId: string,
  variant: DlVariant,
  deps?: DownloadDeps,
): Promise<void> {
  const { tokens } = await requestTokens(
    slug,
    [photoId],
    variant,
    undefined,
    deps,
  );
  const token = tokens[0];
  if (!token) throw new DownloadError("unavailable");
  // /dl answers with an attachment (mock mode: a 302 to the image, which just navigates).
  clickAnchor(token.url, token.filename);
}

const isIos = (ua: string) => /iPhone|iPad/.test(ua);

export function estimateBytes(
  count: number,
  variant: DlVariant,
  totalBytes?: number,
): number {
  return totalBytes && totalBytes > 0 ? totalBytes : count * AVG_BYTES[variant];
}

/** Warn BEFORE a download that would be held in memory (no file picker). */
export function bulkWarning(o: {
  count: number;
  variant: DlVariant;
  totalBytes?: number;
  picker: boolean;
  userAgent?: string;
}): "ios" | "large" | null {
  if (o.picker) return null;
  const ua =
    o.userAgent ??
    (typeof navigator === "undefined" ? "" : navigator.userAgent);
  if (isIos(ua)) return "ios";
  return estimateBytes(o.count, o.variant, o.totalBytes) > LARGE_BYTES
    ? "large"
    : null;
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / MB))} MB`;
}

export function currentPicker(): SavePicker | undefined {
  const w = typeof window === "undefined" ? undefined : window;
  const fn = (w as unknown as { showSaveFilePicker?: SavePicker } | undefined)
    ?.showSaveFilePicker;
  return fn ? fn.bind(w) : undefined;
}

export type BulkProgress = {
  done: number;
  total: number;
  bytes: number;
  failed: string[];
  /** Seconds until a rate-limit wait ends (only while waiting). */
  waiting?: number;
};
export type BulkResult = BulkProgress & {
  status: "done" | "cancelled";
  sink: "picker" | "blob" | null;
};

export type BulkOptions = {
  slug: string;
  scope: BulkScope;
  set?: string;
  variant: DlVariant;
  onProgress?: (p: BulkProgress) => void;
  signal?: AbortSignal;
  /** photoId -> set name, used for folders when scope is "all". */
  sets?: ReadonlyMap<string, string>;
  deps?: DownloadDeps;
  /**
   * The save picker failed for a reason other than the visitor cancelling.
   * Resolve true to fall back to an in-memory Blob, false to cancel.
   * Without it the fallback happens silently.
   */
  confirmFallback?: () => Promise<boolean>;
  /**
   * Called after the plan when the run would be held in memory (no picker) and
   * the server's byte total (else an estimate) is above ~1.5 GB. Resolve false
   * to cancel. Not asked again after `confirmFallback` was already answered.
   */
  confirmLarge?: () => Promise<boolean>;
};

/** Name of the zip a bulk run produces (also the picker's suggestion). */
export function bulkZipName(o: {
  slug: string;
  scope: BulkScope;
  set?: string;
  variant: DlVariant;
}): string {
  const parts = [o.slug, ...(o.scope === "set" && o.set ? [o.set] : [])]
    .map((p) => safeZipName(p, 60))
    .join("-");
  return `${safeZipName(parts, 100)}-${o.variant}.zip`;
}

const abortError = () => new DOMException("Aborted", "AbortError");
const isAbort = (e: unknown) =>
  e instanceof DOMException && e.name === "AbortError";

// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f/\\:]/g;
const MAX_NAME = 120;

/**
 * One safe path segment for a zip entry / zip file: no separators, colons or
 * control chars; whitespace collapsed; no leading/trailing dots or spaces;
 * never "." / ".."; at most 120 code points (a short extension is kept).
 */
export function safeZipName(name: string, max = MAX_NAME): string {
  const clean = name
    .replace(UNSAFE, " ")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "");
  if (!clean) return "_";
  const cps = Array.from(clean);
  if (cps.length <= max) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 ? Array.from(clean.slice(dot)) : [];
  if (ext.length > 0 && ext.length <= 10)
    return (
      cps
        .slice(0, max - ext.length)
        .join("")
        .replace(/[. ]+$/, "") + ext.join("")
    );
  return (
    cps
      .slice(0, max)
      .join("")
      .replace(/[. ]+$/, "") || "_"
  );
}

function uniqueName(used: Set<string>, path: string): string {
  const slash = path.lastIndexOf("/") + 1;
  const dot = path.lastIndexOf(".");
  const stem = dot > slash ? path.slice(0, dot) : path;
  const ext = dot > slash ? path.slice(dot) : "";
  let name = path;
  for (let n = 2; used.has(name.toLowerCase()); n++)
    name = `${stem} (${n})${ext}`;
  used.add(name.toLowerCase());
  return name;
}

const MAX_RATE_RETRIES = 5;
/** One rate-limit window of /dl and the token endpoints. */
const MAX_RETRY_AFTER_MS = 600_000;
/** All 429 waiting of one run. */
const MAX_TOTAL_WAIT_MS = 12 * 60_000;

/** Wait before retrying a 429: the `Retry-After` header (seconds or date), else exponential; capped. */
function retryAfterMs(header: string | null, attempt: number): number {
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

function defaultSaveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  clickAnchor(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** What every step of one bulk run shares: options, progress, the 429 waiter. */
type Run = {
  opts: BulkOptions;
  fetchFn: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  progress: BulkProgress;
  emit: () => void;
  waiter: Waiter;
  result: (
    status: BulkResult["status"],
    sink: BulkResult["sink"],
  ) => BulkResult;
};

function createRun(opts: BulkOptions): Run {
  const { signal, deps } = opts;
  const progress: BulkProgress = { done: 0, total: 0, bytes: 0, failed: [] };
  const emit = () =>
    opts.onProgress?.({ ...progress, failed: [...progress.failed] });
  return {
    opts,
    fetchFn: doFetch(deps),
    sleep: (ms) => abortableSleep(deps?.sleep ?? defaultSleep, ms, signal),
    progress,
    emit,
    waiter: createWaiter(deps, signal, (secs) => {
      if (secs === null) delete progress.waiting;
      else progress.waiting = secs;
      emit();
    }),
    result: (status, sink) => ({
      ...progress,
      failed: [...progress.failed],
      status,
      sink,
    }),
  };
}

type PickedSink = {
  writable: WritableStream<Uint8Array> | null;
  /** The picker failed for a reason other than the visitor cancelling. */
  pickerFailed: boolean;
};

/**
 * Opens the save picker (it needs a live user activation, so before any
 * await) and settles it. Returns the cancelled result when the visitor
 * cancels the picker or declines the fallback.
 */
async function openSink(
  run: Run,
  zipName: string,
): Promise<PickedSink | BulkResult> {
  const { opts } = run;
  const picker = opts.deps?.showSaveFilePicker ?? currentPicker();
  let pickedP: Promise<WritableStream<Uint8Array> | null> =
    Promise.resolve(null);
  if (picker) {
    try {
      pickedP = picker({
        suggestedName: zipName,
        types: [
          { description: "ZIP", accept: { "application/zip": [".zip"] } },
        ],
      }).then((h) => h.createWritable());
    } catch (err) {
      pickedP = Promise.reject(err);
    }
    pickedP.catch(() => {});
  }
  let writable: WritableStream<Uint8Array> | null = null;
  let pickerFailed = false;
  try {
    writable = await pickedP;
  } catch (err) {
    if (isAbort(err)) return run.result("cancelled", "picker");
    pickerFailed = true;
  }
  if (pickerFailed && opts.confirmFallback && !(await opts.confirmFallback()))
    return run.result("cancelled", "picker");
  return { writable, pickerFailed };
}

type BulkPlan = {
  bulkId: string | null;
  photoIds: string[];
  totalBytes?: number;
};

/** Asks the server which photos the run covers; null when aborted meanwhile. */
async function fetchPlan(run: Run): Promise<BulkPlan | null> {
  const { opts } = run;
  const res = await post(
    opts.slug,
    "bulk",
    {
      scope: opts.scope,
      ...(opts.scope === "set" ? { set: opts.set } : {}),
      variant: opts.variant,
    },
    opts.deps,
    opts.signal,
    run.waiter,
  ).catch((e) => {
    if (opts.signal?.aborted) return null;
    throw e;
  });
  return res ? ((await res.json()) as BulkPlan) : null;
}

/** Path of a file inside the zip: set folders (scope "all", several sets), safe and unique names. */
function createZipPaths(opts: BulkOptions): (token: Token) => string {
  const folders =
    opts.scope === "all" && opts.sets && new Set(opts.sets.values()).size > 1;
  const used = new Set<string>();
  const folderOf = new Map<string, string>();
  const usedFolders = new Set<string>();
  const folderName = (set: string) => {
    let f = folderOf.get(set);
    if (f === undefined) {
      const stem = safeZipName(set);
      f = stem;
      for (let n = 2; usedFolders.has(f.toLowerCase()); n++)
        f = safeZipName(`${stem} (${n})`);
      usedFolders.add(f.toLowerCase());
      folderOf.set(set, f);
    }
    return f;
  };
  return (token) => {
    const set = opts.sets?.get(token.photoId);
    const path =
      folders && set
        ? `${folderName(set)}/${safeZipName(token.filename)}`
        : safeZipName(token.filename);
    return uniqueName(used, path);
  };
}

type FetchedFile = { token: Token; res: Response | null };

/**
 * One file with the run's retry policy: network/5xx retried with backoff, a
 * 410 refreshed once per photo, a 429 waited out (one shared pause for all
 * workers), 403/404 final. `res` is null when the file failed or aborted.
 */
function createFileFetcher(
  run: Run,
  bulkId: string,
): (first: Token) => Promise<FetchedFile> {
  const { signal } = run.opts;
  const refreshed = new Set<string>();
  let pause: Promise<void> | null = null;
  const startPause = (ms: number): boolean => {
    if (!pause) {
      if (!run.waiter.canWait(ms)) return false;
      pause = run.waiter.wait(ms).finally(() => {
        pause = null;
      });
    }
    return true;
  };

  return async function fetchFile(first) {
    let token = first;
    let tries = 0;
    let rateTries = 0;
    for (;;) {
      if (signal?.aborted) return { token, res: null };
      while (pause) await pause;
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
            const r = await requestTokens(
              run.opts.slug,
              [token.photoId],
              run.opts.variant,
              bulkId,
              run.opts.deps,
              signal,
              run.waiter,
            );
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
            !startPause(
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

/** Download tokens in batches, just in time (they only live 10 minutes). */
async function* tokenSource(
  run: Run,
  plan: BulkPlan,
  bulkId: string,
): AsyncGenerator<Token> {
  const { opts, progress } = run;
  for (let i = 0; i < plan.photoIds.length; i += BATCH_SIZE) {
    if (opts.signal?.aborted) throw abortError();
    const batch = plan.photoIds.slice(i, i + BATCH_SIZE);
    const r = await requestTokens(
      opts.slug,
      batch,
      opts.variant,
      bulkId,
      opts.deps,
      opts.signal,
      run.waiter,
    );
    for (const id of [...r.missing, ...r.unavailable]) {
      progress.failed.push(id);
      progress.done++;
      run.emit();
    }
    yield* r.tokens;
  }
}

/** Counts the bytes of a response body as the zip consumes it. */
function countingBody(res: Response, progress: BulkProgress) {
  return res.body
    ? res.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, ctl) {
            progress.bytes += chunk.byteLength;
            ctl.enqueue(chunk);
          },
        }),
      )
    : res.blob();
}

/** The zip entries: up to CONCURRENCY files in flight, yielded in token order. */
async function* zipEntries(run: Run, plan: BulkPlan, bulkId: string) {
  const { opts, progress } = run;
  const fetchFile = createFileFetcher(run, bulkId);
  const pathFor = createZipPaths(opts);
  const source = tokenSource(run, plan, bulkId);
  const pending: Promise<FetchedFile>[] = [];
  let exhausted = false;
  run.emit();
  for (;;) {
    while (pending.length < CONCURRENCY && !exhausted) {
      if (opts.signal?.aborted) throw abortError();
      const next = await source.next();
      if (next.done) exhausted = true;
      else pending.push(fetchFile(next.value));
    }
    const head = pending.shift();
    if (!head) break;
    const { token, res } = await head;
    if (opts.signal?.aborted) throw abortError();
    if (!res) {
      progress.failed.push(token.filename);
    } else {
      const input = await countingBody(res, progress);
      yield { name: pathFor(token), input, lastModified: new Date() };
    }
    progress.done++;
    run.emit();
  }
}

/** Streams the zip into the picked file or an in-memory Blob; maps aborts to a cancelled result. */
async function writeZip(
  run: Run,
  entries: AsyncGenerator<{
    name: string;
    input: ReadableStream<Uint8Array> | Blob;
    lastModified: Date;
  }>,
  {
    writable,
    zipName,
  }: { writable: WritableStream<Uint8Array> | null; zipName: string },
): Promise<BulkResult> {
  const { signal, deps } = run.opts;
  const sink = writable ? "picker" : "blob";
  // client-zip wraps what the generator throws; remember the original.
  let fatal: unknown;
  async function* watched() {
    try {
      yield* entries;
    } catch (e) {
      fatal ??= e;
      throw e;
    }
  }
  try {
    const zip = downloadZip(watched());
    if (writable) {
      await zip.body!.pipeTo(writable, { signal });
    } else {
      const blob = await zip.blob();
      if (signal?.aborted) return run.result("cancelled", sink);
      (deps?.saveBlob ?? defaultSaveBlob)(blob, zipName);
    }
  } catch (caught) {
    const err = fatal ?? caught;
    await writable?.abort().catch(() => {});
    if (signal?.aborted || isAbort(err)) return run.result("cancelled", sink);
    throw err;
  }
  return run.result("done", sink);
}

export async function downloadBulk(opts: BulkOptions): Promise<BulkResult> {
  const { slug, scope, variant, signal } = opts;
  const run = createRun(opts);
  if (signal?.aborted) return run.result("cancelled", null);

  const zipName = bulkZipName({ slug, scope, set: opts.set, variant });
  const picked = await openSink(run, zipName);
  if ("status" in picked) return picked;
  const { writable, pickerFailed } = picked;
  const cancelNow = async () => {
    await writable?.abort().catch(() => {});
    return run.result("cancelled", null);
  };
  if (signal?.aborted) return cancelNow();

  const plan = await fetchPlan(run);
  if (!plan) return run.result("cancelled", null);
  run.progress.total = plan.photoIds.length;
  if (!plan.bulkId || plan.photoIds.length === 0) {
    run.emit();
    return run.result("done", null);
  }

  if (
    !writable &&
    !pickerFailed &&
    opts.confirmLarge &&
    estimateBytes(plan.photoIds.length, variant, plan.totalBytes) >
      LARGE_BYTES &&
    !(await opts.confirmLarge())
  )
    return run.result("cancelled", "blob");
  if (signal?.aborted) return cancelNow();

  return writeZip(run, zipEntries(run, plan, plan.bulkId), {
    writable,
    zipName,
  });
}
