import { nowIso } from "../../db";
import type { TFunction } from "../../i18n/t";
import {
  parseSweepCursor,
  parseSweepTotals,
  SWEEP_SCAN_VALID_MS,
  sweepPage,
} from "./orphan-sweep";
import type { SweepTotals } from "./orphan-sweep";
import {
  deleteSetting,
  getSetting,
  putSetting,
  SETTINGS_KEYS,
} from "./settings";

/** What the browser gets back: numbers only, never a key. */
export interface SweepState {
  phase: "scan" | "delete";
  totals: SweepTotals;
  /** Where the next request continues; null = finished. */
  cursor: string | null;
  done: boolean;
}

export interface SweepActionResult {
  intent: "sweepScan" | "sweepDelete";
  ok: boolean;
  error?: string;
  sweep?: SweepState;
}

/** True when a scan finished recently enough that its totals were shown to the owner. */
async function scannedRecently(env: Env): Promise<boolean> {
  const at = Date.parse(
    (await getSetting(env, SETTINGS_KEYS.orphanSweepScanned)) ?? "",
  );
  return Number.isFinite(at) && Date.now() - at <= SWEEP_SCAN_VALID_MS;
}

/**
 * A dry run only counts as a whole walk when it began at the start and every
 * page followed the cursor the server handed out last: a forged cursor (one
 * page near the end) never unlocks the delete.
 */
async function scanContinues(
  env: Env,
  cursor: string | null,
): Promise<boolean> {
  if (cursor === null) return true;
  return (await getSetting(env, SETTINGS_KEYS.orphanSweepNext)) === cursor;
}

/**
 * Admin intents 'sweepScan' (dry run) and 'sweepDelete' (needs `confirm=1` and a
 * finished scan): one bounded page per call, continued with the posted cursor.
 */
export async function sweepIntent(
  env: Env,
  intent: "sweepScan" | "sweepDelete",
  form: FormData,
  t: TFunction,
): Promise<SweepActionResult> {
  const phase = intent === "sweepScan" ? "scan" : "delete";
  const fail = (error: string, sweep?: SweepState): SweepActionResult => ({
    intent,
    ok: false,
    error,
    sweep,
  });
  const cursor = parseSweepCursor(form.get("cursor"));
  if (cursor === undefined) return fail(t("admin.msg.sweepFailed"));
  const totals = parseSweepTotals(form.get("totals"));
  const resume: SweepState = { phase, totals, cursor, done: false };
  try {
    if (phase === "delete") {
      if (form.get("confirm") !== "1")
        return fail(t("admin.msg.sweepConfirm"), resume);
      if (!(await scannedRecently(env)))
        return fail(t("admin.msg.sweepNoScan"));
    }
    const chained = phase === "scan" && (await scanContinues(env, cursor));
    const page = await sweepPage(env, { mode: phase, cursor, totals });
    const done = page.cursor === null;
    if (phase === "delete") {
      if (done) await deleteSetting(env, SETTINGS_KEYS.orphanSweepScanned);
    } else if (chained && !done)
      await putSetting(env, SETTINGS_KEYS.orphanSweepNext, page.cursor ?? "");
    else {
      await deleteSetting(env, SETTINGS_KEYS.orphanSweepNext);
      if (chained)
        await putSetting(env, SETTINGS_KEYS.orphanSweepScanned, nowIso());
    }
    return {
      intent,
      ok: true,
      sweep: { phase, totals: page.totals, cursor: page.cursor, done },
    };
  } catch (err) {
    console.error(
      "orphan sweep failed",
      err instanceof Error ? err.name : "error",
    );
    return fail(t("admin.msg.sweepFailed"), resume);
  }
}
