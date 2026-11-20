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
import { isAvailable } from "./access";
import type { DriveClient } from "./drive-types";
import { fillCacheShared } from "./images";
import type { Variant } from "./images";
import { hit, type RateRule } from "./rate-limit";
import { SETTINGS_KEYS, getSetting } from "./settings";

/** External (Drive + OAuth) subrequests one open may spend; Workers Free allows 50 per invocation. */
export const OPEN_WARM_BUDGET = 16;
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

/** Warms the next photos of the open gallery `slug`. Never throws on Drive/R2 errors. */
export async function warmGalleryOnOpen(
  env: Env,
  drive: DriveClient,
  slug: string,
): Promise<OpenWarmResult> {
  const result: OpenWarmResult = { warmed: 0, failed: 0 };
  if (env.DRIVE_MODE === "mock") return { ...result, skipped: "mock" };
  const db = getDb(env);
  const [g] = await db.select().from(G).where(eq(G.slug, slug));
  if (!isAvailable(g)) return { ...result, skipped: "unavailable" };
  const syncLock = await getSetting(env, SETTINGS_KEYS.syncLock);
  if (syncLock && syncLock.split("|")[0] > new Date().toISOString())
    return { ...result, skipped: "sync_running" };
  if (running.has(g.id)) return { ...result, skipped: "running" };

  const cursorKey = SETTINGS_KEYS.warmCursorPrefix + g.id;
  const stamp = (await getSetting(env, SETTINGS_KEYS.warmStamp)) ?? "";
  const cursor = parseCursor(await getSetting(env, cursorKey), stamp);
  if (cursor === "done") return { ...result, skipped: "done" };
  if (!(await hit(env, OPEN_WARM_RATE, g.id)))
    return { ...result, skipped: "limited" };

  running.add(g.id);
  try {
    let { phase, after, failed: sawFailure } = cursor;
    const start = drive.subrequests();
    const proofing = g.mode === "proofing";
    let scanned = 0;
    walk: while (phase < PHASES.length) {
      const rows = await db
        .select({
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
        })
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
        let failed = false;
        for (const variant of PHASES[phase]) {
          if (drive.subrequests() - start + CALL_RESERVE > OPEN_WARM_BUDGET) {
            result.stopped = "budget";
            break walk;
          }
          try {
            if (
              (await fillCacheShared(
                env,
                { ...row, proofing },
                variant,
                drive,
              )) === "filled"
            )
              result.warmed++;
          } catch (err) {
            // Name only: messages may hold Drive ids.
            console.error(
              "warm-open: fill failed",
              err instanceof Error ? err.name : "error",
            );
            result.failed++;
            failed = true;
            break;
          }
        }
        // A failing photo is passed over (the cron and real views retry it),
        // but the run stops: Drive is probably unhappy.
        after = [row.setName, row.sort, row.baseName];
        scanned++;
        if (failed) {
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
    // Only while the gallery still exists: a delete that ran meanwhile must
    // not be followed by a stray cursor row.
    await env.DB.prepare(
      `INSERT INTO settings (key, value) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM galleries WHERE id = ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
      .bind(cursorKey, serializeCursor(next, stamp), g.id)
      .run();
    return result;
  } finally {
    running.delete(g.id);
  }
}
