import { IMAGE_VARIANTS } from "../constants";
import type { ImageVariant as Variant } from "../constants";
import type { DriveClient } from "./drive-types";
import { resolveSource } from "./image-source";
import type { Source, SourcePhoto } from "./image-source";

/** R2 cache of served images: validation, store, sibling copy, shared (de-duplicated) fills. */
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export function safeType(raw: string | null | undefined): string {
  const t = (raw ?? "").split(";")[0].trim().toLowerCase();
  return IMAGE_TYPES.includes(t) ? t : "image/jpeg";
}

/** Manual pump: pipeTo into a FixedLengthStream is unsupported for tee()d branches in workerd. */
async function pump(
  src: ReadableStream<Uint8Array>,
  dst: WritableStream<Uint8Array>,
): Promise<void> {
  const reader = src.getReader();
  const writer = dst.getWriter();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
    }
    await writer.close();
  } catch (err) {
    await writer.abort(err).catch(() => {});
    throw err;
  }
}

export function isValidHit(hit: R2Object, src: Source): boolean {
  return (
    !!src.version &&
    hit.customMetadata?.fileId === src.fileId &&
    hit.customMetadata?.wm === (src.watermark ? "1" : "0") &&
    hit.customMetadata?.v === src.version
  );
}

export async function storeInCache(
  env: Pick<Env, "CACHE">,
  key: string,
  body: ReadableStream<Uint8Array>,
  length: number,
  contentType: string,
  customMetadata: { fileId: string; wm: string; v: string },
): Promise<void> {
  const fixed = new FixedLengthStream(length);
  await Promise.all([
    pump(body, fixed.writable),
    env.CACHE.put(key, fixed.readable, {
      httpMetadata: { contentType },
      customMetadata,
    }),
  ]);
}

/** Copies the R2 object of another variant of `photoId` that is the same source file/version. */
async function copyFromSibling(
  env: Pick<Env, "CACHE">,
  photoId: string,
  variant: Variant,
  src: Source,
): Promise<boolean> {
  for (const other of IMAGE_VARIANTS) {
    if (other === variant) continue;
    const head = await env.CACHE.head(`${photoId}/${other}`);
    if (!head || !isValidHit(head, src)) continue;
    const obj = await env.CACHE.get(`${photoId}/${other}`);
    if (!obj) continue;
    if (!isValidHit(obj, src)) {
      await obj.body.cancel();
      continue;
    }
    await env.CACHE.put(`${photoId}/${variant}`, obj.body, {
      httpMetadata: { contentType: safeType(obj.httpMetadata?.contentType) },
      customMetadata: {
        fileId: src.fileId,
        wm: src.watermark ? "1" : "0",
        v: src.version,
      },
    });
    return true;
  }
  return false;
}

export type FillResult = "cached" | "filled" | "skipped";

/**
 * Makes sure R2 holds the current `variant` of `photo` (same resolution,
 * validation and put/customMetadata as /img). Costs one Drive call on a miss.
 * "skipped": nothing to cache (no source file / unknown version / no length).
 * Throws on Drive or R2 failure.
 */
export async function fillCache(
  env: Pick<Env, "CACHE">,
  photo: SourcePhoto & { proofing: boolean },
  variant: Variant,
  drive: DriveClient,
): Promise<FillResult> {
  const src = resolveSource(photo, photo.proofing, variant);
  if (!src || !src.version) return "skipped";
  const key = `${photo.id}/${variant}`;
  const head = await env.CACHE.head(key);
  if (head && isValidHit(head, src)) return "cached";
  // Another variant of this photo may already hold these very bytes (Prueba:
  // thumb, view-sm and view-lg are one preview-wm file): copy, don't refetch.
  if (await copyFromSibling(env, photo.id, variant, src)) return "filled";
  const upstream = await drive.streamFile(src.fileId);
  const rawLength = upstream.headers.get("Content-Length")?.trim();
  const length = rawLength ? Number(rawLength) : Number.NaN;
  if (!upstream.body || !Number.isInteger(length) || length <= 0) {
    await upstream.body?.cancel();
    return "skipped";
  }
  await storeInCache(
    env,
    key,
    upstream.body,
    length,
    safeType(upstream.headers.get("Content-Type")),
    { fileId: src.fileId, wm: src.watermark ? "1" : "0", v: src.version },
  );
  return "filled";
}

/** Fills in flight in this isolate, by R2 key AND exact source (file, watermark, version). */
const inFlight = new Map<string, Promise<FillResult>>();
/** The newest fill per R2 key, so fills of different sources for one key run in order. */
const tail = new Map<string, Promise<FillResult>>();

function fillId(key: string, src: Source | null): string {
  return src
    ? `${key}|${src.fileId}|${src.watermark ? 1 : 0}|${src.version}`
    : `${key}|-`;
}

/** The in-flight fill of exactly this R2 key and source, if one is running here. */
export function pendingFill(
  key: string,
  src: Source,
): Promise<FillResult> | undefined {
  return inFlight.get(fillId(key, src));
}

/**
 * `fillCache`, but a second caller for the same photo, variant AND source
 * while one is running awaits that one instead of fetching Drive again. A
 * caller with a different (newer) source never joins: it runs after the
 * earlier fill of that key and re-validates against its own source, so R2 ends
 * up holding what the last caller expects. Rejects like `fillCache`.
 */
export function fillCacheShared(
  env: Pick<Env, "CACHE">,
  photo: SourcePhoto & { proofing: boolean },
  variant: Variant,
  drive: DriveClient,
): Promise<FillResult> {
  const key = `${photo.id}/${variant}`;
  const id = fillId(key, resolveSource(photo, photo.proofing, variant));
  const running = inFlight.get(id);
  if (running) return running;
  const prior = tail.get(key);
  const start = prior
    ? prior
        .catch(() => undefined)
        .then(() => fillCache(env, photo, variant, drive))
    : fillCache(env, photo, variant, drive);
  const fill: Promise<FillResult> = start.finally(() => {
    inFlight.delete(id);
    if (tail.get(key) === fill) tail.delete(key);
  });
  inFlight.set(id, fill);
  tail.set(key, fill);
  return fill;
}

/** How long a visitor waits for a fill that is already running before fetching Drive itself. */
export const PENDING_FILL_WAIT_MS = 2000;

export async function waitForFill(fill: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    fill.catch(() => {}),
    new Promise<void>((r) => {
      timer = setTimeout(r, PENDING_FILL_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
}
