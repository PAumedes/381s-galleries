import { useEffect, useRef, useState } from "react";

/** Versioned, no PII: only records that this browser has seen the hint. */
export const SWIPE_HINT_KEY = "swipe-hint:v1";
export const SWIPE_HINT_MS = 2000;
export const SWIPE_HINT_FADE_MS = 400;

export type SwipeHintPhase = "off" | "on" | "fading";
export type SwipeHint = { phase: SwipeHintPhase; animated: boolean };

const media = (q: string) =>
  typeof window.matchMedia === "function" && window.matchMedia(q).matches;

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(SWIPE_HINT_KEY) !== null;
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SWIPE_HINT_KEY, "1");
  } catch {
    /* storage unavailable: the hint may show again, nothing else */
  }
}

const OFF: SwipeHint = { phase: "off", animated: false };

/**
 * First-time swipe hint: touch devices only, once per browser, ~2s, dismissed
 * by the first pointer down. Reduced motion keeps it briefly with no fade.
 * `enabled` is false when there is nothing to swipe to (single photo).
 * The seen flag is written only when the hint finishes or is dismissed, so a
 * quick close does not burn it; the effect is idempotent (StrictMode-safe).
 */
export function useSwipeHint(enabled: boolean): SwipeHint {
  const [hint, setHint] = useState<SwipeHint>(OFF);
  const seen = useRef<boolean | null>(null);
  useEffect(() => {
    if (!enabled || !media("(pointer: coarse)")) return;
    seen.current ??= alreadySeen();
    if (seen.current) return;
    const animated = !media("(prefers-reduced-motion: reduce)");
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stop = () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
      document.removeEventListener("pointerdown", fade, true);
    };
    const end = () => {
      stop();
      markSeen();
      seen.current = true;
      setHint(OFF);
    };
    function fade() {
      stop();
      markSeen();
      seen.current = true;
      if (!animated) return end();
      setHint({ phase: "fading", animated });
      timers.push(setTimeout(end, SWIPE_HINT_FADE_MS));
    }
    // Browser-only facts (media, storage) are known only after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHint({ phase: "on", animated });
    document.addEventListener("pointerdown", fade, true);
    timers.push(setTimeout(fade, SWIPE_HINT_MS));
    return stop;
  }, [enabled]);
  return hint;
}
