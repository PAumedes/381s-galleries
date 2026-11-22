import { useLayoutEffect, useState } from "react";

import type { GalleryPhoto } from "../types";
import { SLIDE_MS, canAnimate, photoEls, run } from "./motion";

type Slide = { from: GalleryPhoto; dir: 1 | -1; carry: number; n: number };

/**
 * Slide transition between neighbouring photos. When the index moves by one
 * the old photo is kept as `leaving` and both slide (WAAPI) from where the
 * finger let go (`carry`), whether or not the new full photo has loaded: the
 * stage draws its cached thumbnail as a placeholder, so there is never a
 * black frame. No-op without Web Animations or with reduced motion.
 */
export function useSlide(
  stage: React.RefObject<HTMLElement | null>,
  photos: readonly GalleryPhoto[],
  index: number,
  dragX: number,
) {
  const [seen, setSeen] = useState(index);
  const [slide, setSlide] = useState<Slide | null>(null);
  // Last non-zero drag offset = where the finger let go (reset once used or
  // once the photo sprang back).
  const [lastDrag, setLastDrag] = useState(0);
  if (dragX !== 0 ? lastDrag !== dragX : lastDrag !== 0) {
    setLastDrag(dragX);
  }

  if (seen !== index) {
    setSeen(index);
    const from = photos[seen];
    const to = photos[index];
    setSlide(
      from && to && Math.abs(index - seen) === 1 && canAnimate()
        ? {
            from,
            dir: index > seen ? 1 : -1,
            carry: lastDrag,
            n: (slide?.n ?? 0) + 1,
          }
        : null,
    );
  }

  const n = slide?.n;
  useLayoutEffect(() => {
    const el = stage.current;
    if (!slide || !el) return;
    const W = window.innerWidth;
    const { dir, carry: c } = slide;
    const runs: Promise<void>[] = [];
    for (const e of photoEls(el)) {
      const leaving = e.hasAttribute("data-lb-leaving");
      runs.push(
        run(
          e,
          leaving
            ? [
                { transform: `translateX(${c}px)` },
                { transform: `translateX(${-dir * W}px)` },
              ]
            : [
                { transform: `translateX(${dir * W + c}px)` },
                { transform: "translateX(0)" },
              ],
          SLIDE_MS,
        ),
      );
    }
    let live = true;
    Promise.all(runs).then(() => {
      if (live) setSlide((s) => (s && s.n === n ? null : s));
    });
    return () => {
      live = false;
    };
    // Keyed on the slide serial only: it is the whole trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, stage]);

  return slide?.from;
}
