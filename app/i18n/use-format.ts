import { useMemo } from "react";

import {
  fmtStudioDateTime,
  fmtLocalDateTime,
  fmtNumber,
  fmtPlainDate,
} from "./format";
import { useStudioTimezone } from "../lib/use-studio-timezone";
import { useLang } from "./use-t";

/** Language-aware formatters (es-AR / en) bound to the current UI language. */
export function useFormat() {
  const lang = useLang();
  const tz = useStudioTimezone();
  return useMemo(
    () => ({
      lang,
      tz,
      /** UTC ISO instant -> studio-time date and time; falls back to the input. */
      dateTime: (iso: string) => fmtStudioDateTime(lang, iso, tz) || iso,
      /** Like `dateTime` but "" for invalid input. */
      dateTimeOrEmpty: (iso: string | null | undefined) =>
        fmtStudioDateTime(lang, iso, tz),
      localDateTime: (date: string, time: string) =>
        fmtLocalDateTime(lang, date, time),
      date: (date: string | null) => fmtPlainDate(lang, date),
      number: (n: number) => fmtNumber(lang, n),
    }),
    [lang, tz],
  );
}
