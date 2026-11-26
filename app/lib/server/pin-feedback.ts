/** What the PIN gate answers to a refused attempt (T6.54): text + attempt number. */
import { enPublic } from "../../i18n/en.public";
import { esPublic } from "../../i18n/es.public";
import { getLang } from "../../i18n/lang";
import { makeT } from "../../i18n/t";
import type { UnlockResult } from "./gallery-pin";

export type PinFeedback = { error: string; attempt: number };

/**
 * Message and next attempt number for a refused unlock (`status` is not 303).
 * The number is the posted one plus 1 and is never clamped (the parse caps the
 * posted one at 4 digits), so every answer differs from the previous one and
 * the alert and the shake re-mount on every attempt.
 */
export function pinFeedback(
  request: Request,
  result: Exclude<UnlockResult, { status: 303 }>,
): PinFeedback {
  const lang = getLang(request);
  const t = makeT(lang, lang === "en" ? enPublic : esPublic);
  const attempt = result.attempt + 1;
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
