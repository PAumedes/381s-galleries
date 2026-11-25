/** What the PIN gate answers to a refused attempt (T6.54): text + attempt number. */
import { enPublic } from "../../i18n/en.public";
import { esPublic } from "../../i18n/es.public";
import { getLang } from "../../i18n/lang";
import { makeT } from "../../i18n/t";
import type { UnlockResult } from "./gallery-pin";

/** The counter is cosmetic (the limiter is the rate limit); clamp it anyway. */
export const MAX_SHOWN_ATTEMPT = 100;

export type PinFeedback = { error: string; attempt: number };

/**
 * The attempt number the visitor's form carried (hidden `attempt` field);
 * 0 when missing or not a plain count. Read from a clone, the unlock reads
 * the body itself.
 */
export async function postedAttempt(request: Request): Promise<number> {
  try {
    const v = (await request.clone().formData()).get("attempt");
    if (typeof v !== "string" || !/^\d{1,4}$/.test(v)) return 0;
    return Math.min(Number(v), MAX_SHOWN_ATTEMPT - 1);
  } catch {
    return 0;
  }
}

/** Message and next attempt number for a refused unlock (`status` is not 303). */
export function pinFeedback(
  request: Request,
  result: Exclude<UnlockResult, { status: 303 }>,
  posted: number,
): PinFeedback {
  const lang = getLang(request);
  const t = makeT(lang, lang === "en" ? enPublic : esPublic);
  const attempt = posted + 1;
  switch (result.status) {
    case 429:
      return { error: t("pin.tooManyAttempts"), attempt };
    case 403:
      return { error: t("pin.forbidden"), attempt };
    case 404:
      return { error: t("unavailable.message"), attempt };
    case 400:
      return {
        error: t(`pin.wrong.${result.step}`, { n: attempt }),
        attempt,
      };
  }
}
