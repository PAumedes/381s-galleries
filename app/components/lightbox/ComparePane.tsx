import { useEffect, useReducer, useRef } from "react";

import type { TFunction } from "../../i18n/t";
import { CompareFrame, type CompareMode } from "./CompareFrame";
import { BTN } from "./styles";

/** Where the two previews are: how many came in, or one failed. */
type Loads = { count: number; failed: boolean };
type LoadAction = "load" | "error";
const loadReducer = (s: Loads, a: LoadAction): Loads =>
  a === "load" ? { ...s, count: s.count + 1 } : { ...s, failed: true };

type Side = { n: number; src: string };

type Props = {
  t: TFunction;
  mode: CompareMode;
  top: Side;
  under: Side;
  flipped: boolean;
  onFlip: () => void;
  rtl: boolean;
  onRetry: () => void;
};

/**
 * The frame plus its loading and error states. The caller keys it by the
 * preview pair and the retry attempt, so every new pair starts at "loading"
 * and keyboard focus is placed again (frame control, or Retry after an error).
 */
export function ComparePane({ t, onRetry, ...frame }: Props) {
  const [loads, load] = useReducer(loadReducer, { count: 0, failed: false });
  const retry = useRef<HTMLButtonElement>(null);
  const failed = loads.failed;
  useEffect(() => {
    const target = failed
      ? retry.current
      : document.querySelector<HTMLElement>(
          '[data-testid="compare-flip"], [role="slider"]',
        );
    target?.focus();
  }, [failed]);
  if (failed) {
    return (
      <div
        role="alert"
        className="flex size-full flex-col items-center justify-center gap-3 text-center"
      >
        <span>{t("compare.error")}</span>
        <button
          ref={retry}
          type="button"
          className={`${BTN} w-auto min-w-11 px-3 text-micro uppercase underline`}
          onClick={onRetry}
        >
          {t("lightbox.retry")}
        </button>
      </div>
    );
  }
  const ready = loads.count >= 2;
  return (
    <>
      <CompareFrame
        t={t}
        {...frame}
        ready={ready}
        onLoad={() => load("load")}
        onError={() => load("error")}
      />
      {!ready && (
        <p
          data-testid="compare-loading"
          role="status"
          className="absolute inset-0 flex items-center justify-center text-micro uppercase text-white/70"
        >
          {t("compare.loading")}
        </p>
      )}
    </>
  );
}
