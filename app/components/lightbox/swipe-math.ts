const SWIPE_DISTANCE = 50;
const SWIPE_VELOCITY = 0.5; // px per ms
const SWIPE_MIN_FAST = 20;
const CLOSE_DISTANCE = 80;

export type SwipeOutcome = "next" | "prev" | "close" | null;

/**
 * What a released touch drag means. `dx`/`dy`: travel since pointer down;
 * `dt`: milliseconds it took (at least 1). Horizontal wins when |dx| > |dy|:
 * a long or fast-enough swipe navigates (left = next); otherwise a pull down
 * far enough, or fast enough, closes.
 */
export function swipeOutcome(dx: number, dy: number, dt: number): SwipeOutcome {
  if (Math.abs(dx) > Math.abs(dy)) {
    const fast =
      Math.abs(dx) >= SWIPE_MIN_FAST && Math.abs(dx) / dt > SWIPE_VELOCITY;
    if (Math.abs(dx) < SWIPE_DISTANCE && !fast) return null;
    return dx < 0 ? "next" : "prev";
  }
  return dy >= CLOSE_DISTANCE ||
    (dy >= SWIPE_MIN_FAST * 2 && dy / dt > SWIPE_VELOCITY)
    ? "close"
    : null;
}

/**
 * How far the photo follows the finger: horizontally (a quarter of the pull at
 * an edge with nothing to go to: `blocked`), or, when vertical wins, only a
 * pull down once the touch counts as a drag.
 */
export function dragOffsets(
  dx: number,
  dy: number,
  dragged: boolean,
  hasPrev: boolean,
  hasNext: boolean,
): { x: number; y: number | null } {
  if (Math.abs(dx) > Math.abs(dy)) {
    const blocked = (dx > 0 && !hasPrev) || (dx < 0 && !hasNext);
    return { x: blocked ? dx / 4 : dx, y: 0 };
  }
  // y null: leave the vertical offset as it is (not dragging yet).
  return { x: 0, y: dragged ? Math.max(0, dy) : null };
}
