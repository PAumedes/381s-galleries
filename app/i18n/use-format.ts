import { useMemo } from "react";

import {
  fmtStudioDateTime,
  fmtLocalDateTime,
  fmtNumber,
  fmtPlainDate,
} from "./format";
import { useLang } from "./use-t";

/** Language-aware formatters (es-AR / en) bound to the current UI language. */
export function useFormat() {
  const lang = useLang();
  return useMemo(
    () => ({
      lang,
      /** UTC ISO instant -> Buenos Aires date and time; falls back to the input. */
      dateTime: (iso: string) => fmtStudioDateTime(lang, iso) || iso,
      /** Like `dateTime` but "" for invalid input. */
      dateTimeOrEmpty: (iso: string | null | undefined) =>
        fmtStudioDateTime(lang, iso),
      localDateTime: (date: string, time: string) =>
        fmtLocalDateTime(lang, date, time),
      date: (date: string | null) => fmtPlainDate(lang, date),
      number: (n: number) => fmtNumber(lang, n),
    }),
    [lang],
  );
}
