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
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import { OPEN_WARM_D1_BUDGET, PUBLISH_WARM_D1_BUDGET } from "./d1-limits";
import { isAvailable } from "./access";
import type { DriveClient } from "./drive-types";
import { fillCacheShared } from "./images";
import type { Variant } from "./images";
import { hit, type RateRule } from "./rate-limit";
import { SETTINGS_KEYS, getSetting } from "./settings";
import {
  START,
  parseCursor,
  saveCursor,
  type Cursor,
  type GridKey,
} from "./gallery-warm-cursor";
import {
  CALL_RESERVE,
  OPEN_WARM_BUDGET,
  d1Exhausted,
  metered,
  type Allowance,
} from "./gallery-warm-budget";
import { markWarmed } from "./warm";
import { GalleryGone, gated, stillAvailable } from "./warm-gate";

export { OPEN_WARM_BUDGET, d1Exhausted };
export type { Allowance };

/** Photos looked at per run (bounds D1 rows and R2 head calls). */
export const OPEN_WARM_SCAN = 40;
/** Warm runs per gallery and minute (opens beyond that are ignored). */
export const OPEN_WARM_RATE: RateRule = {
  scope: "warm-open",
  max: 6,
  windowMs: 60_000,
};

/** Phase 0 first for the whole gallery, then phase 1. */
const PHASES: readonly (readonly Variant[])[] = [
  ["thumb", "view-sm"],
  ["view-lg"],
];

const P = schema.photos;
const G = schema.galleries;

export interface OpenWarmResult {
  skipped?:
    "mock" | "unavailable" | "sync_running" | "running" | "limited" | "done";
  warmed: number;
  failed: number;
  stopped?: "budget" | "scan" | "error";
  /** The whole grid is in R2 (the cursor is `done`): a pending marker may clear. */
  finished?: true;
}

/** Galleries being warmed in this isolate (one run at a time each). */
const running = new Set<string>();

const ROW_COLUMNS = {
  id: P.id,
  setName: P.setName,
  sort: P.sort,
  baseName: P.baseName,
  driveHighresId: P.driveHighresId,
  driveWebId: P.driveWebId,
  driveIgId: P.driveIgId,
  driveThumbId: P.driveThumbId,
  driveWmId: P.driveWmId,
  driveThumbWmId: P.driveThumbWmId,
  variantVersions: P.variantVersions,
};
type WarmRow = Pick<typeof P.$inferSelect, keyof typeof ROW_COLUMNS>;
type GalleryRow = typeof G.$inferSelect;

/**
 * Fills `variants` of one photo while the run's Drive budget lasts. "failed":
 * Drive/R2 refused (the photo is passed over, the cron and real views retry
 * it); "budget": stopped before the call that would not fit; "gone": the
 * gallery was unpublished/expired meanwhile. Once thumb and view-sm are both
 * in R2 the cron's marker is set, so "Photos ready" counts the photo.
 */
async function fillRow(
  env: Env,
  drive: DriveClient,
  photo: WarmRow & { proofing: boolean },
  galleryId: string,
  variants: readonly Variant[],
  span: Allowance,
  result: OpenWarmResult,
): Promise<"ok" | "budget" | "failed" | "gone"> {
  const done = new Set<Variant>();
  const gate = gated(env, drive, galleryId, photo.proofing);
  for (const variant of variants) {
    if (drive.subrequests() - span.start + CALL_RESERVE > span.budget) {
      result.stopped = "budget";
      return "budget";
    }
    try {
      const filled = await fillCacheShared(env, photo, variant, gate);
      if (filled === "filled") result.warmed++;
      if (filled !== "skipped") done.add(variant);
    } catch (err) {
      if (err instanceof GalleryGone) return "gone";
      // Name only: messages may hold Drive ids.
      console.error(
        "warm-open: fill failed",
        err instanceof Error ? err.name : "error",
      );
      result.failed++;
      return "failed";
    }
    if (done.has("thumb") && done.has("view-sm") && variant !== "thumb") {
      await markWarmed(env, photo, photo.proofing).catch(() => undefined);
    }
  }
  return "ok";
}

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

/** One page of visible photos after `after`, in grid order. */
function gridPage(env: Env, galleryId: string, after: GridKey | null) {
  return getDb(env)
    .select(ROW_COLUMNS)
    .from(P)
    .innerJoin(G, and(eq(G.id, P.galleryId), ne(G.status, "archived")))
    .where(
      and(
        eq(P.galleryId, galleryId),
        photoVisible,
        after
          ? sql`(${P.setName}, ${P.sort}, ${P.baseName}) > (${after[0]}, ${after[1]}, ${after[2]})`
          : undefined,
      ),
    )
    .orderBy(asc(P.setName), asc(P.sort), asc(P.baseName))
    .limit(OPEN_WARM_SCAN);
}

/** Where the walk ends up: done, a fresh pass (a file failed), or on. */
function nextCursor(cursor: Cursor): Cursor | "done" {
  // A finished pass with a failed file starts over (cheap: cached files only
  // cost a head) so the file is retried; the rate rule bounds how often.
  if (cursor.phase >= PHASES.length) return cursor.failed ? START : "done";
  return cursor;
}

/** The cursor-driven walk of the grid; the caller holds the guards. */
async function walkGrid(
  env: Env,
  drive: DriveClient,
  g: GalleryRow,
  span: Allowance = { start: drive.subrequests(), budget: OPEN_WARM_BUDGET },
): Promise<OpenWarmResult> {
  const result: OpenWarmResult = { warmed: 0, failed: 0 };
  const cursorKey = SETTINGS_KEYS.warmCursorPrefix + g.id;
  const stamp = (await getSetting(env, SETTINGS_KEYS.warmStamp)) ?? "";
  const cursor = parseCursor(await getSetting(env, cursorKey), stamp);
  if (cursor === "done") return { ...result, skipped: "done", finished: true };

  let { phase, after, failed: sawFailure } = cursor;
  const proofing = g.mode === "proofing";
  let scanned = 0;
  walk: while (phase < PHASES.length) {
    if (d1Exhausted(span, 1)) {
      result.stopped = "budget";
      break;
    }
    if (!(await stillAvailable(env, g.id, proofing))) {
      result.stopped = "error";
      return result;
    }
    const rows: WarmRow[] = await gridPage(env, g.id, after);
    if (rows.length === 0) {
      phase++;
      after = null;
      continue;
    }
    for (const row of rows) {
      if (scanned >= OPEN_WARM_SCAN) {
        result.stopped = "scan";
        break walk;
      }
      if (d1Exhausted(span)) {
        result.stopped = "budget";
        break walk;
      }
      const step = await fillRow(
        env,
        drive,
        { ...row, proofing },
        g.id,
        PHASES[phase],
        span,
        result,
      );
      if (step === "budget") break walk;
      if (step === "gone") return result;
      // A failing photo is passed over (the cron and real views retry it),
      // but the run stops: Drive is probably unhappy.
      after = [row.setName, row.sort, row.baseName];
      scanned++;
      if (step === "failed") {
        sawFailure = true;
        result.stopped = "error";
        break walk;
      }
    }
  }
  const next = nextCursor({ phase, after, failed: sawFailure });
  if (next === "done") result.finished = true;
  await saveCursor(env, cursorKey, g.id, next, stamp);
  return result;
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
    const [row] = await db
      .select(ROW_COLUMNS)
      .from(P)
      .where(and(eq(P.id, id), eq(P.galleryId, g.id), photoVisible));
    if (!row) continue;
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
