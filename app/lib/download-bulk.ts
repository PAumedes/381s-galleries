/** Bulk (zip) download: plan, tokens just in time, retries, zip to a picked file or a Blob. */
import { downloadZip } from "client-zip";
import {
  abortableSleep,
  abortError,
  BATCH_SIZE,
  clickAnchor,
  CONCURRENCY,
  createWaiter,
  currentPicker,
  defaultSleep,
  doFetch,
  isAbort,
  post,
  requestTokens,
} from "./download-net";
import type {
  BulkScope,
  DlVariant,
  DownloadDeps,
  Token,
  Waiter,
} from "./download-net";
import { createFileFetcher } from "./download-file";
import type { FetchedFile } from "./download-file";
import { bulkZipName, createZipPaths } from "./zip-names";

export const LARGE_BYTES = 1.5 * 1024 * 1024 * 1024;
export const MB = 1024 * 1024;
const AVG_BYTES: Record<DlVariant, number> = {
  web: 1.2 * MB,
  highres: 3 * MB,
  ig: 0.6 * MB,
};

export function estimateBytes(
  count: number,
  variant: DlVariant,
  totalBytes?: number,
): number {
  return totalBytes && totalBytes > 0 ? totalBytes : count * AVG_BYTES[variant];
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
