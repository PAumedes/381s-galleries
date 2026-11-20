import { useEffect, useState } from "react";

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
 */
export function useSwipeHint(): SwipeHint {
  const [hint, setHint] = useState<SwipeHint>(OFF);
  useEffect(() => {
    if (!media("(pointer: coarse)") || alreadySeen()) return;
    markSeen();
    const animated = !media("(prefers-reduced-motion: reduce)");
    const timers: ReturnType<typeof setTimeout>[] = [];
    const end = () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
      document.removeEventListener("pointerdown", fade, true);
      setHint(OFF);
    };
    function fade() {
      document.removeEventListener("pointerdown", fade, true);
      timers.forEach(clearTimeout);
      timers.length = 0;
      if (!animated) return end();
      setHint({ phase: "fading", animated });
      timers.push(setTimeout(end, SWIPE_HINT_FADE_MS));
    }
    // Browser-only facts (media, storage) are known only after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHint({ phase: "on", animated });
    document.addEventListener("pointerdown", fade, true);
    timers.push(setTimeout(fade, SWIPE_HINT_MS));
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener("pointerdown", fade, true);
    };
  }, []);
  return hint;
}
