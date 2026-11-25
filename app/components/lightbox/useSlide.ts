import { useLayoutEffect, useState } from "react";

import type { GalleryPhoto } from "../types";
import { SLIDE_MS, canAnimate, photoEls, run } from "./motion";

type Slide = { from: GalleryPhoto; dir: 1 | -1; carry: number; n: number };

/** The slide for a move from `seen` to `index`: only between neighbours, and only when animating is possible. */
function nextSlide(
  photos: readonly GalleryPhoto[],
  seen: number,
  index: number,
  carry: number,
  serial: number,
): Slide | null {
  const from = photos[seen];
  const to = photos[index];
  if (!from || !to || Math.abs(index - seen) !== 1 || !canAnimate())
    return null;
  return { from, dir: index > seen ? 1 : -1, carry, n: serial + 1 };
}

/** Animates every photo element in the stage: the leaving one out, the entering one in, both from the finger's release point. */
function slideRuns(stage: HTMLElement, { dir, carry }: Slide) {
  const W = window.innerWidth;
  return photoEls(stage).map((e) =>
    run(
      e,
      e.hasAttribute("data-lb-leaving")
        ? [
            { transform: `translateX(${carry}px)` },
            { transform: `translateX(${-dir * W}px)` },
          ]
        : [
            { transform: `translateX(${dir * W + carry}px)` },
            { transform: "translateX(0)" },
          ],
      SLIDE_MS,
    ),
  );
}

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
    setSlide(nextSlide(photos, seen, index, lastDrag, slide?.n ?? 0));
  }

  const n = slide?.n;
  useLayoutEffect(() => {
    const el = stage.current;
    if (!slide || !el) return;
    const runs = slideRuns(el, slide);
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
