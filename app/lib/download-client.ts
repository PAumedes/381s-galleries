import { downloadZip } from "client-zip";

import { EmailRequiredError } from "../components/use-visitor";

export type DlVariant = "highres" | "web" | "ig";
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
  retry = false,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await postOnce(slug, path, body, deps, signal);
    } catch (err) {
      if (
        !retry ||
        !(err instanceof RateLimitedError) ||
        attempt >= MAX_RATE_RETRIES
      )
        throw err;
      const wait = retryAfterMs(err.retryAfter, attempt);
      await (deps?.sleep ?? defaultSleep)(wait);
      if (signal?.aborted) throw abortError();
    }
  }
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
): Promise<TokenResult> {
  const res = await post(
    slug,
    "download-tokens",
    { photoIds, variant, ...(bulkId ? { bulkId } : {}) },
    deps,
    signal,
    Boolean(bulkId),
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
const MAX_RETRY_AFTER_MS = 60_000;

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

export async function downloadBulk(opts: BulkOptions): Promise<BulkResult> {
  const { slug, scope, variant, signal, deps } = opts;
  const fetchFn = doFetch(deps);
  const sleep = deps?.sleep ?? defaultSleep;
  const progress: BulkProgress = { done: 0, total: 0, bytes: 0, failed: [] };
  const emit = () =>
    opts.onProgress?.({ ...progress, failed: [...progress.failed] });
  const result = (
    status: BulkResult["status"],
    sink: BulkResult["sink"],
  ): BulkResult => ({
    ...progress,
    failed: [...progress.failed],
    status,
    sink,
  });

  if (signal?.aborted) return result("cancelled", null);

  // The picker needs a live user activation: open it before any await.
  const zipName = bulkZipName({ slug, scope, set: opts.set, variant });
  const picker = deps?.showSaveFilePicker ?? currentPicker();
  let pickerFailed = false;
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
  try {
    writable = await pickedP;
  } catch (err) {
    if (isAbort(err)) return result("cancelled", "picker");
    pickerFailed = true;
  }
  if (pickerFailed && opts.confirmFallback && !(await opts.confirmFallback()))
    return result("cancelled", "picker");
  if (signal?.aborted) {
    await writable?.abort().catch(() => {});
    return result("cancelled", null);
  }

  const planRes = await post(
    slug,
    "bulk",
    { scope, ...(scope === "set" ? { set: opts.set } : {}), variant },
    deps,
    signal,
    true,
  ).catch((e) => {
    if (signal?.aborted) return null;
    throw e;
  });
  if (!planRes) return result("cancelled", null);
  const plan = (await planRes.json()) as {
    bulkId: string | null;
    photoIds: string[];
    totalBytes?: number;
  };
  progress.total = plan.photoIds.length;
  if (!plan.bulkId || plan.photoIds.length === 0) {
    emit();
    return result("done", null);
  }
  const bulkId = plan.bulkId;

  if (
    !writable &&
    !pickerFailed &&
    opts.confirmLarge &&
    estimateBytes(plan.photoIds.length, variant, plan.totalBytes) >
      LARGE_BYTES &&
    !(await opts.confirmLarge())
  )
    return result("cancelled", "blob");
  if (signal?.aborted) {
    await writable?.abort().catch(() => {});
    return result("cancelled", null);
  }

  const sink = writable ? "picker" : "blob";

  const folders =
    scope === "all" && opts.sets && new Set(opts.sets.values()).size > 1;
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
  const refreshed = new Set<string>();
  let pause: Promise<void> | null = null;
  const startPause = (ms: number) => {
    pause ??= sleep(ms).finally(() => {
      pause = null;
    });
  };

  async function fetchFile(
    first: Token,
  ): Promise<{ token: Token; res: Response | null }> {
    let token = first;
    let tries = 0;
    let rateTries = 0;
    for (;;) {
      if (signal?.aborted) return { token, res: null };
      while (pause) await pause;
      let res: Response | null = null;
      try {
        res = await fetchFn(token.url, { signal });
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
              slug,
              [token.photoId],
              variant,
              bulkId,
              deps,
              signal,
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
          startPause(retryAfterMs(res.headers.get("Retry-After"), rateTries++));
          continue;
        }
        // Expired / revoked / missing: retrying cannot help.
        if ([403, 404, 410].includes(res.status)) return { token, res: null };
      }
      if (tries >= RETRIES) return { token, res: null };
      await sleep(BACKOFF_MS * 2 ** tries++);
    }
  }

  type Item = { token: Token; res: Response | null };
  async function* tokenSource(): AsyncGenerator<Token> {
    for (let i = 0; i < plan.photoIds.length; i += BATCH_SIZE) {
      if (signal?.aborted) throw abortError();
      // Just in time: tokens only live 10 minutes.
      const batch = plan.photoIds.slice(i, i + BATCH_SIZE);
      const r = await requestTokens(slug, batch, variant, bulkId, deps, signal);
      for (const id of [...r.missing, ...r.unavailable]) {
        progress.failed.push(id);
        progress.done++;
        emit();
      }
      yield* r.tokens;
    }
  }

  async function* innerEntries() {
    const source = tokenSource();
    const pending: Promise<Item>[] = [];
    let exhausted = false;
    emit();
    for (;;) {
      while (pending.length < CONCURRENCY && !exhausted) {
        if (signal?.aborted) throw abortError();
        const next = await source.next();
        if (next.done) exhausted = true;
        else {
          const token = next.value;
          pending.push(fetchFile(token));
        }
      }
      const head = pending.shift();
      if (!head) break;
      const { token, res } = await head;
      if (signal?.aborted) throw abortError();
      if (!res) {
        progress.failed.push(token.filename);
      } else {
        const set = opts.sets?.get(token.photoId);
        const path =
          folders && set
            ? `${folderName(set)}/${safeZipName(token.filename)}`
            : safeZipName(token.filename);
        const input = res.body
          ? res.body.pipeThrough(
              new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, ctl) {
                  progress.bytes += chunk.byteLength;
                  ctl.enqueue(chunk);
                },
              }),
            )
          : await res.blob();
        yield { name: uniqueName(used, path), input, lastModified: new Date() };
      }
      progress.done++;
      emit();
    }
  }

  // client-zip wraps what the generator throws; remember the original.
  let fatal: unknown;
  async function* entries() {
    try {
      yield* innerEntries();
    } catch (e) {
      fatal ??= e;
      throw e;
    }
  }

  try {
    const zip = downloadZip(entries());
    if (writable) {
      await zip.body!.pipeTo(writable, { signal });
    } else {
      const blob = await zip.blob();
      if (signal?.aborted) return result("cancelled", sink);
      (deps?.saveBlob ?? defaultSaveBlob)(blob, zipName);
    }
  } catch (caught) {
    const err = fatal ?? caught;
    if (signal?.aborted || isAbort(err)) {
      await writable?.abort().catch(() => {});
      return result("cancelled", sink);
    }
    await writable?.abort().catch(() => {});
    throw err;
  }
  return result("done", sink);
}
