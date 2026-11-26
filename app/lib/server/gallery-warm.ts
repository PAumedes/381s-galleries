/**
 * Warm-on-open (T6.30). The minute cron warms thumb + view-sm of every stale
 * photo, but view-lg is never warmed and a freshly synced gallery takes many
 * runs to get through. When a visitor opens a gallery this fills R2 for the
 * NEXT photos in grid order (thumb + view-sm of the whole gallery first, then
 * view-lg), from `ctx.waitUntil`, so the photos they are about to scroll to or
 * open are already cached.
 *
 * Bounded: a Drive subrequest budget per run (worst case reserved per call,
 * like the cover warm), a cap on photos looked at, a per-gallery rate rule and
 * one run at a time per gallery. A cursor in `settings` remembers how far the
 * previous opens got, so repeated opens progress without refetching.
 * Resolution, validation and metadata are `fillCache`'s: Prueba only ever
 * fetches and stores watermarked files.
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import { OPEN_WARM_D1_BUDGET, PUBLISH_WARM_D1_BUDGET } from "./d1-limits";
import { isAvailable } from "./access";
import type { DriveClient } from "./drive-types";
import type { Variant } from "./images";
import { latestOf } from "./photo-versions";
import { hit, type RateRule } from "./rate-limit";
import { SETTINGS_KEYS, getSetting } from "./settings";
import {
  OPEN_WARM_BUDGET,
  d1Exhausted,
  metered,
  type Allowance,
} from "./gallery-warm-budget";
import {
  OPEN_WARM_SCAN,
  ROW_COLUMNS,
  fillRow,
  walkGrid,
  type GalleryRow,
  type OpenWarmResult,
} from "./gallery-warm-walk";

export { OPEN_WARM_BUDGET, d1Exhausted };
export { OPEN_WARM_SCAN };
export type { Allowance, OpenWarmResult };

/** Warm runs per gallery and minute (opens beyond that are ignored). */
export const OPEN_WARM_RATE: RateRule = {
  scope: "warm-open",
  max: 6,
  windowMs: 60_000,
};

const P = schema.photos;
const G = schema.galleries;

/** Galleries being warmed in this isolate (one run at a time each). */
const running = new Set<string>();

type Skip = NonNullable<OpenWarmResult["skipped"]>;

/**
 * The guards both warms share, in order: sync lock, one run per gallery,
 * rate rule. Runs `body` holding the per-gallery lock.
 */
async function guarded(
  env: Env,
  g: GalleryRow,
  body: () => Promise<OpenWarmResult>,
): Promise<OpenWarmResult> {
  const skip = (skipped: Skip): OpenWarmResult => ({
    warmed: 0,
    failed: 0,
    skipped,
  });
  const syncLock = await getSetting(env, SETTINGS_KEYS.syncLock);
  if (syncLock && syncLock.split("|")[0] > new Date().toISOString())
    return skip("sync_running");
  if (running.has(g.id)) return skip("running");
  if (!(await hit(env, OPEN_WARM_RATE, g.id))) return skip("limited");
  running.add(g.id);
  try {
    return await body();
  } finally {
    running.delete(g.id);
  }
}

/**
 * Open warm: `slug` of the gallery a visitor just opened. Warms the next
 * photos of the grid. Never throws on Drive/R2 errors.
 */
export async function warmGalleryOnOpen(
  baseEnv: Env,
  drive: DriveClient,
  slug: string,
  d1Budget = OPEN_WARM_D1_BUDGET,
): Promise<OpenWarmResult> {
  if (baseEnv.DRIVE_MODE === "mock")
    return { warmed: 0, failed: 0, skipped: "mock" };
  const { env, span } = metered(baseEnv, drive, OPEN_WARM_BUDGET, d1Budget);
  const [g] = await getDb(env).select().from(G).where(eq(G.slug, slug));
  if (!isAvailable(g)) return { warmed: 0, failed: 0, skipped: "unavailable" };
  return guarded(env, g, () => walkGrid(env, drive, g, span));
}

/**
 * Continues the grid walk of a gallery a sync marked as needing warm
 * (warm-after-sync.ts): same guards (sync lock, one run, rate rule) and the
 * same cursor as the open warm, with the caller's Drive allowance.
 */
export function warmGalleryPending(
  env: Env,
  drive: DriveClient,
  g: GalleryRow,
  span: Allowance,
): Promise<OpenWarmResult> {
  return guarded(env, g, () => walkGrid(env, drive, g, span));
}

/**
 * What a cover needs in R2 before the first visitor: grid thumb and hero
 * view-sm, then (Entrega only, last and optional: it is the budget's call)
 * view-lg. In Prueba view-lg is the same preview-wm file as view-sm.
 */
const coverVariants = (proofing: boolean): readonly Variant[] =>
  proofing ? ["thumb", "view-sm"] : ["thumb", "view-sm", "view-lg"];

/**
 * Fills the cover(s) of `g` (the first photo when none is chosen). False when
 * the run must end there: budget spent, or a file failed/gone.
 */
async function warmCovers(
  env: Env,
  drive: DriveClient,
  g: GalleryRow,
  span: Allowance,
  result: OpenWarmResult,
): Promise<boolean> {
  const db = getDb(env);
  const proofing = g.mode === "proofing";
  const [first] = await db
    .select(ROW_COLUMNS)
    .from(P)
    .where(and(eq(P.galleryId, g.id), photoVisible))
    .orderBy(asc(P.setName), asc(P.sort), asc(P.baseName))
    .limit(1);
  const ids = [g.coverPhotoId ?? first?.id, g.coverPhotoIdMobile].filter(
    (id): id is string => !!id,
  );
  for (const id of new Set(ids)) {
    if (d1Exhausted(span)) {
      result.stopped = "budget";
      return false;
    }
    const [stored] = await db
      .select(ROW_COLUMNS)
      .from(P)
      .where(and(eq(P.id, id), eq(P.galleryId, g.id), photoVisible));
    if (!stored) continue;
    const [row] = await latestOf(env, g, [stored]);
    const step = await fillRow(
      env,
      drive,
      { ...row, proofing },
      g.id,
      coverVariants(proofing),
      span,
      result,
    );
    if (step !== "ok") return false;
  }
  return true;
}

/**
 * Publish warm (T6.37): the gallery just became visible. Same guards as the
 * open warm (sync lock, one run, rate rule), held for the whole run. Fills
 * the cover(s) first (the first photo when none is chosen), then continues
 * the open warm (same cursor and budget, so nothing is fetched twice). Never
 * throws; a draft/archived/expired gallery is skipped. No mock check: the
 * caller passes a `drive` only outside mock mode.
 */
export async function warmGalleryAtPublish(
  baseEnv: Env,
  drive: DriveClient,
  galleryId: string,
  d1Budget = PUBLISH_WARM_D1_BUDGET,
): Promise<OpenWarmResult> {
  const result: OpenWarmResult = { warmed: 0, failed: 0 };
  const { env, span } = metered(baseEnv, drive, OPEN_WARM_BUDGET, d1Budget);
  try {
    const [g] = await getDb(env).select().from(G).where(eq(G.id, galleryId));
    if (!isAvailable(g))
      return { warmed: 0, failed: 0, skipped: "unavailable" };
    return await guarded(env, g, async () => {
      if (!(await warmCovers(env, drive, g, span, result))) return result;
      // walkGrid opens with its own availability check.
      const rest = await walkGrid(env, drive, g, span);
      return {
        ...rest,
        warmed: rest.warmed + result.warmed,
        failed: rest.failed + result.failed,
      };
    });
  } catch (err) {
    console.error(
      "warm-publish: failed",
      err instanceof Error ? err.name : "error",
    );
    return result;
  }
}

/** Hands the publish warm to `waitUntil`; nothing without ctx/drive (mock mode). */
export function scheduleWarmAtPublish(
  env: Env,
  deps:
    | { ctx?: Pick<ExecutionContext, "waitUntil">; drive?: DriveClient }
    | undefined,
  galleryId: string,
): void {
  if (!deps?.ctx || !deps.drive) return;
  deps.ctx.waitUntil(warmGalleryAtPublish(env, deps.drive, galleryId));
}
