import { useEffect, useState } from "react";

/** Pinch-zoomed beyond this scale counts as zoomed (ignores rounding noise). */
const ZOOMED_SCALE = 1.01;

export const isZoomed = () =>
  typeof window !== "undefined" &&
  (window.visualViewport?.scale ?? 1) > ZOOMED_SCALE;

/** Tracks pinch-zoom so the root can allow one-finger panning only while zoomed. */
export function useZoomed() {
  const [zoomed, setZoomed] = useState(isZoomed);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv?.addEventListener) return;
    const update = () => setZoomed(isZoomed());
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);
  return zoomed;
}
