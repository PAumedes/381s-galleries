import type { TFunction } from "../../i18n/t";
import { ChevronLeft, ChevronRight } from "../icons";
import { useSwipeHint } from "./useSwipeHint";

/** Faint edge chevrons + a short label; never takes pointer events. */
export function SwipeHint({
  t,
  hasPrev,
  hasNext,
}: {
  t: TFunction;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const { phase, animated } = useSwipeHint();
  if (phase === "off") return null;
  const fade = animated
    ? `transition-opacity duration-slow ease-out-soft ${phase === "fading" ? "opacity-0" : "opacity-100"}`
    : "";
  const chevron = "absolute top-1/2 size-12 -translate-y-1/2 text-white/50";
  return (
    <div
      data-swipe-hint
      data-state={phase}
      className={`pointer-events-none absolute inset-0 ${fade}`}
    >
      {hasPrev && (
        <ChevronLeft
          data-swipe-hint-chevron
          data-side="left"
          aria-hidden="true"
          className={`${chevron} left-2`}
        />
      )}
      {hasNext && (
        <ChevronRight
          data-swipe-hint-chevron
          data-side="right"
          aria-hidden="true"
          className={`${chevron} right-2`}
        />
      )}
      <p
        aria-live="polite"
        className="absolute inset-x-0 bottom-24 text-center text-body text-white/80"
      >
        {t("lightbox.swipeHint")}
      </p>
    </div>
  );
}
