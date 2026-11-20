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
import { and, asc, eq, ne } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import type { DriveClient } from "./drive-types";
import { fillCacheShared } from "./images";
import type { Variant } from "./images";
import { rateLimit } from "./rate-limit";
import { SETTINGS_KEYS, getSetting, putSetting } from "./settings";

/** External (Drive + OAuth) subrequests one open may spend; Workers Free allows 50 per invocation. */
export const OPEN_WARM_BUDGET = 16;
/** Worst case of ONE Drive call: the file, 3 retries and an OAuth refresh. */
const CALL_RESERVE = 3 + 2;
/** Photos looked at per run (bounds D1 rows and R2 head calls). */
export const OPEN_WARM_SCAN = 40;
/** Warm runs per gallery and minute (opens beyond that are ignored). */
export const OPEN_WARM_RATE = {
  scope: "warm-open",
  max: 6,
  windowMs: 60_000,
} as const;

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

interface Cursor {
  phase: number;
  offset: number;
}

function parseCursor(raw: string | undefined, stamp: string): Cursor | "done" {
  const [a, b, c] = (raw ?? "").split(":");
  if (a === "done" && b === stamp) return "done";
  const phase = Number(a);
  const offset = Number(b);
  if (c === stamp && Number.isInteger(phase) && Number.isInteger(offset))
    return { phase, offset };
  return { phase: 0, offset: 0 };
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
  const [g] = await db
    .select({ id: G.id, mode: G.mode })
    .from(G)
    .where(and(eq(G.slug, slug), eq(G.status, "published")));
  if (!g) return { ...result, skipped: "unavailable" };
  const syncLock = await getSetting(env, SETTINGS_KEYS.syncLock);
  if (syncLock && syncLock.split("|")[0] > new Date().toISOString())
    return { ...result, skipped: "sync_running" };
  if (running.has(g.id)) return { ...result, skipped: "running" };

  const cursorKey = SETTINGS_KEYS.warmCursorPrefix + g.id;
  const stamp = (await getSetting(env, SETTINGS_KEYS.warmStamp)) ?? "";
  const cursor = parseCursor(await getSetting(env, cursorKey), stamp);
  if (cursor === "done") return { ...result, skipped: "done" };
  const { scope, max, windowMs } = OPEN_WARM_RATE;
  if (!(await rateLimit(env, scope, g.id, max, windowMs)))
    return { ...result, skipped: "limited" };

  running.add(g.id);
  try {
    let { phase, offset } = cursor;
    const start = drive.subrequests();
    const proofing = g.mode === "proofing";
    let scanned = 0;
    walk: while (phase < PHASES.length) {
      const rows = await db
        .select({
          id: P.id,
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
        .where(and(eq(P.galleryId, g.id), photoVisible))
        .orderBy(asc(P.setName), asc(P.sort), asc(P.baseName))
        .limit(OPEN_WARM_SCAN)
        .offset(offset);
      if (rows.length === 0) {
        phase++;
        offset = 0;
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
        offset++;
        scanned++;
        if (failed) {
          result.stopped = "error";
          break walk;
        }
      }
    }
    await putSetting(
      env,
      cursorKey,
      phase >= PHASES.length ? `done:${stamp}` : `${phase}:${offset}:${stamp}`,
    );
    return result;
  } finally {
    running.delete(g.id);
  }
}
