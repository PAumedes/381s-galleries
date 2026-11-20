/** Slide between photos and the swipe-down exit share these timings. */
export const SLIDE_MS = 220;
export const EXIT_MS = 200;
export const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)"; // --ease-out-soft

/** Photo scale and backdrop opacity while it is pulled down by `y` px. */
export const pullScale = (y: number) => 1 - Math.min(y / 1500, 0.15);
export const pullBackdrop = (y: number, height: number) =>
  Math.max(0.25, 1 - y / Math.max(1, height * 0.6));

/** CSS transform of the photo for a drag offset (undefined at rest). */
export function dragTransform(x: number, y: number): string | undefined {
  if (y) return `translateY(${y}px) scale(${pullScale(y)})`;
  return x ? `translateX(${x}px)` : undefined;
}

const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Web Animations available (not in jsdom) and the visitor has not opted out. */
export const canAnimate = () =>
  !reducedMotion() &&
  typeof Element !== "undefined" &&
  typeof Element.prototype.animate === "function";

/** Runs one animation; resolves when it ends (or is cancelled). */
export function run(
  el: Element,
  frames: Keyframe[],
  duration: number,
  fill: FillMode = "none",
): Promise<void> {
  const a = el.animate(frames, { duration, easing: EASE, fill });
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

/** Everything in the dialog that moves with the photo. */
export const photoEls = (root: Element) =>
  Array.from(root.querySelectorAll("[data-lb-photo]"));

/**
 * Pull-down exit: the photo slides off the bottom while the backdrop fades.
 * Resolves when done; the caller then closes. Elements keep their final state
 * (fill: forwards) so nothing flashes back before the unmount.
 */
export function exitDown(root: HTMLElement, fromY: number): Promise<void> {
  const h = window.innerHeight;
  const moves = photoEls(root).map((el) =>
    run(
      el,
      [
        { transform: `translateY(${fromY}px) scale(${pullScale(fromY)})` },
        { transform: `translateY(${h}px) scale(0.85)`, opacity: 0.6 },
      ],
      EXIT_MS,
      "forwards",
    ),
  );
  const fade = root.querySelector("[data-lb-backdrop]");
  if (fade)
    moves.push(
      run(
        fade,
        [{ opacity: pullBackdrop(fromY, h) }, { opacity: 0 }],
        EXIT_MS,
        "forwards",
      ),
    );
  return Promise.all(moves).then(() => undefined);
}
