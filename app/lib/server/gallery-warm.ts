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
import { meterD1 } from "./d1-meter";
import type { D1Allowance } from "./d1-meter";
import { isAvailable } from "./access";
import type { DriveClient } from "./drive-types";
import { fillCacheShared } from "./images";
import type { Variant } from "./images";
import { hit, type RateRule } from "./rate-limit";
import { SETTINGS_KEYS, getSetting } from "./settings";
import { markWarmed } from "./warm";
import { GalleryGone, gated, stillAvailable } from "./warm-gate";

/** External (Drive + OAuth) subrequests one open may spend; Workers Free allows 50 per invocation. */
export const OPEN_WARM_BUDGET = 36;
/** Worst case of ONE Drive call: the file, 3 retries and an OAuth refresh. */
const CALL_RESERVE = 3 + 2;
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

/**
 * What one run may spend: Drive subrequests from `start` (`budget`), and
 * optionally D1 queries (`d1.used()` counts them all, `d1.budget` is the cap).
 * Without `d1` the run is bounded by the Drive budget alone.
 */
export interface Allowance {
  start: number;
  budget: number;
  d1?: D1Allowance;
}

/** Worst case of D1 queries for one photo: a gate check per Drive call (2) + the marker (1) + the next page select (1). */
const PHOTO_D1_RESERVE = 4;
/** D1 queries kept for ending the run: the cursor save and the marker clear. */
const FINISH_D1_RESERVE = 2;

/** True when the D1 budget cannot cover one more step plus ending the run cleanly. */
export function d1Exhausted(
  span: Allowance,
  extra = PHOTO_D1_RESERVE,
): boolean {
  return (
    !!span.d1 && span.d1.used() + extra + FINISH_D1_RESERVE > span.d1.budget
  );
}

/** Galleries being warmed in this isolate (one run at a time each). */
const running = new Set<string>();

/** Grid-order position of a photo: the keyset the cursor remembers. */
type GridKey = [setName: string, sort: number, baseName: string];

interface Cursor {
  phase: number;
  /** Last photo handled in this phase (null: from the start). */
  after: GridKey | null;
  /** A file failed during this pass: finishing it starts a new pass, not "done". */
  failed: boolean;
}

const START: Cursor = { phase: 0, after: null, failed: false };

/** Stored cursor as JSON `{p, a, f, s}` (s = warm_stamp) or `{d: 1, s}`; anything else restarts. */
function parseCursor(raw: string | undefined, stamp: string): Cursor | "done" {
  try {
    const c = JSON.parse(raw ?? "") as Record<string, unknown>;
    if (c.s !== stamp) return START;
    if (c.d === 1) return "done";
    const a = c.a;
    const after =
      Array.isArray(a) &&
      a.length === 3 &&
      typeof a[0] === "string" &&
      typeof a[1] === "number" &&
      typeof a[2] === "string"
        ? (a as GridKey)
        : null;
    if (!Number.isInteger(c.p) || (c.p as number) < 0) return START;
    return { phase: c.p as number, after, failed: c.f === 1 };
  } catch {
    return START;
  }
}

function serializeCursor(c: Cursor | "done", stamp: string): string {
  return JSON.stringify(
    c === "done"
      ? { d: 1, s: stamp }
      : { p: c.phase, a: c.after, f: c.failed ? 1 : 0, s: stamp },
  );
}

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

/** `baseEnv` with every D1 query counted, and the allowance that caps the run. */
function metered(
  baseEnv: Env,
  drive: DriveClient,
  budget: number,
  d1Budget: number,
): { env: Env; span: Allowance } {
  const meter = meterD1(baseEnv);
  return {
    env: meter.env,
    span: {
      start: drive.subrequests(),
      budget,
      d1: { used: meter.used, budget: d1Budget },
    },
  };
}

/** The cursor-driven walk of the grid; the caller holds the guards. */
async function walkGrid(
  env: Env,
  drive: DriveClient,
  g: GalleryRow,
  span: Allowance = { start: drive.subrequests(), budget: OPEN_WARM_BUDGET },
): Promise<OpenWarmResult> {
  const result: OpenWarmResult = { warmed: 0, failed: 0 };
  const db = getDb(env);
  const cursorKey = SETTINGS_KEYS.warmCursorPrefix + g.id;
  const stamp = (await getSetting(env, SETTINGS_KEYS.warmStamp)) ?? "";
  const cursor = parseCursor(await getSetting(env, cursorKey), stamp);
  if (cursor === "done") return { ...result, skipped: "done", finished: true };

  {
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
      const rows: WarmRow[] = await db
        .select(ROW_COLUMNS)
        .from(P)
        .innerJoin(G, and(eq(G.id, P.galleryId), ne(G.status, "archived")))
        .where(
          and(
            eq(P.galleryId, g.id),
            photoVisible,
            after
              ? sql`(${P.setName}, ${P.sort}, ${P.baseName}) > (${after[0]}, ${after[1]}, ${after[2]})`
              : undefined,
          ),
        )
        .orderBy(asc(P.setName), asc(P.sort), asc(P.baseName))
        .limit(OPEN_WARM_SCAN);
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
    // A finished pass with a failed file starts over (cheap: cached files only
    // cost a head) so the file is retried; the rate rule bounds how often.
    let next: Cursor | "done" = { phase, after, failed: sawFailure };
    if (phase >= PHASES.length) next = sawFailure ? START : "done";
    if (next === "done") result.finished = true;
    // Only while the gallery still exists: a delete that ran meanwhile must
    // not be followed by a stray cursor row.
    await env.DB.prepare(
      `INSERT INTO settings (key, value) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM galleries WHERE id = ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
      .bind(cursorKey, serializeCursor(next, stamp), g.id)
      .run();
    return result;
  }
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
    const db = getDb(env);
    const [g] = await db.select().from(G).where(eq(G.id, galleryId));
    if (!isAvailable(g))
      return { warmed: 0, failed: 0, skipped: "unavailable" };
    return await guarded(env, g, async () => {
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
          return result;
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
        if (step !== "ok") return result;
      }
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
