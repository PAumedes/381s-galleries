/**
 * The cursor-driven walk of a gallery's grid (see gallery-warm.ts): fills
 * thumb + view-sm of every photo, then view-lg, within the run's allowance.
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import type { DriveClient } from "./drive-types";
import { fillCacheShared } from "./images";
import type { Variant } from "./images";
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
} from "./gallery-warm-budget";
import type { Allowance } from "./gallery-warm-budget";
import { markWarmed } from "./warm";
import { GalleryGone, gated, stillAvailable } from "./warm-gate";

/** Photos looked at per run (bounds D1 rows and R2 head calls). */
export const OPEN_WARM_SCAN = 40;
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

export const ROW_COLUMNS = {
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
export type WarmRow = Pick<typeof P.$inferSelect, keyof typeof ROW_COLUMNS>;
export type GalleryRow = typeof G.$inferSelect;

/**
 * Fills `variants` of one photo while the run's Drive budget lasts. "failed":
 * Drive/R2 refused (the photo is passed over, the cron and real views retry
 * it); "budget": stopped before the call that would not fit; "gone": the
 * gallery was unpublished/expired meanwhile. Once thumb and view-sm are both
 * in R2 the cron's marker is set, so "Photos ready" counts the photo.
 */
export async function fillRow(
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

/** Where a walk stands: its cursor plus the photos looked at in this run. */
interface WalkState extends Cursor {
  scanned: number;
}

/**
 * Fills one page of rows for the current phase. "page": every row done, ask
 * for the next page; "stop": the run ends here (`result.stopped` says why;
 * the cursor is saved); "gone": the gallery vanished (no cursor to save).
 */
async function fillPage(
  env: Env,
  drive: DriveClient,
  g: GalleryRow,
  rows: WarmRow[],
  st: WalkState,
  span: Allowance,
  result: OpenWarmResult,
): Promise<"page" | "stop" | "gone"> {
  const proofing = g.mode === "proofing";
  for (const row of rows) {
    if (st.scanned >= OPEN_WARM_SCAN) {
      result.stopped = "scan";
      return "stop";
    }
    if (d1Exhausted(span)) {
      result.stopped = "budget";
      return "stop";
    }
    const step = await fillRow(
      env,
      drive,
      { ...row, proofing },
      g.id,
      PHASES[st.phase],
      span,
      result,
    );
    if (step === "budget") return "stop";
    if (step === "gone") return "gone";
    // A failing photo is passed over (the cron and real views retry it),
    // but the run stops: Drive is probably unhappy.
    st.after = [row.setName, row.sort, row.baseName];
    st.scanned++;
    if (step === "failed") {
      st.failed = true;
      result.stopped = "error";
      return "stop";
    }
  }
  return "page";
}

/** The cursor-driven walk of the grid; the caller holds the guards. */
export async function walkGrid(
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

  const st: WalkState = { ...cursor, scanned: 0 };
  while (st.phase < PHASES.length) {
    if (d1Exhausted(span, 1)) {
      result.stopped = "budget";
      break;
    }
    if (!(await stillAvailable(env, g.id, g.mode === "proofing"))) {
      result.stopped = "error";
      return result;
    }
    const rows: WarmRow[] = await gridPage(env, g.id, st.after);
    if (rows.length === 0) {
      st.phase++;
      st.after = null;
      continue;
    }
    const outcome = await fillPage(env, drive, g, rows, st, span, result);
    if (outcome === "gone") return result;
    if (outcome === "stop") break;
  }
  const next = nextCursor(st);
  if (next === "done") result.finished = true;
  await saveCursor(env, cursorKey, g.id, next, stamp);
  return result;
}
