import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { dragOffsets, swipeOutcome } from "./swipe-math";
import { isZoomed } from "./useZoomed";

const DRAG_SLOP = 10;

type SwipeInput = {
  hasPrev: boolean;
  hasNext: boolean;
  prev: () => void;
  next: () => void;
  /** `fromY`: how far the photo was pulled down when released. */
  onClose: (fromY: number) => void;
};

type PointerEv = ReactPointerEvent<HTMLDivElement>;

/**
 * Which touch is being tracked, with no React state: down / move / end return
 * what the caller needs to render. Mouse is ignored; a second finger or a
 * zoomed photo cancels the drag.
 */
function useTouchTrack() {
  const pointers = useRef(new Set<number>());
  const drag = useRef<{ x: number; y: number; t: number; id: number } | null>(
    null,
  );
  // Set once a touch drag passes the slop; swallows the trailing click.
  const dragged = useRef(false);

  return {
    /** "reset" when this touch cancels any drag (second finger / zoomed). */
    down(e: PointerEv): "tracking" | "reset" | "ignored" {
      dragged.current = false;
      if (e.pointerType === "mouse") return "ignored";
      pointers.current.add(e.pointerId);
      if (pointers.current.size > 1 || isZoomed()) {
        drag.current = null;
        return "reset";
      }
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        t: Date.now(),
        id: e.pointerId,
      };
      return "tracking";
    },
    /** Travel since pointer down, and whether it already counts as a drag. */
    move(e: PointerEv) {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return null;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) > DRAG_SLOP && !dragged.current) {
        // Capture only once it is a drag, so a plain tap still clicks its target.
        dragged.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      return { dx, dy, dragged: dragged.current };
    },
    /** Ends the tracked touch: its travel and duration (at least 1ms), or null if it was not the tracked one. */
    end(e: PointerEv) {
      pointers.current.delete(e.pointerId);
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return null;
      drag.current = null;
      return {
        dx: e.clientX - d.x,
        dy: e.clientY - d.y,
        dt: Math.max(1, Date.now() - d.t),
      };
    },
    /** The click that ends a touch swipe must not hit what was under it. */
    swallowClick(e: ReactMouseEvent<HTMLDivElement>) {
      if (!dragged.current) return;
      dragged.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };
}

/**
 * Touch gestures on the dialog root: horizontal swipe navigates, a downward
 * swipe closes, the photo follows the finger (`dragX` / `dragY`). Mouse is ignored and
 * a second finger or pinch-zoom cancels.
 */
export function useSwipe({
  hasPrev,
  hasNext,
  prev,
  next,
  onClose,
}: SwipeInput) {
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const track = useTouchTrack();

  const resetDrag = () => {
    setDragX(0);
    setDragY(0);
  };
  const onPointerDown = (e: PointerEv) => {
    if (track.down(e) === "reset") resetDrag();
  };
  const onPointerMove = (e: PointerEv) => {
    const m = track.move(e);
    if (!m) return;
    const off = dragOffsets(m.dx, m.dy, m.dragged, hasPrev, hasNext);
    setDragX(off.x);
    if (off.y !== null) setDragY(off.y);
  };
  const endDrag = (e: PointerEv, cancelled = false) => {
    const t = track.end(e);
    if (!t) return;
    resetDrag();
    if (cancelled || isZoomed()) return;
    const outcome = swipeOutcome(t.dx, t.dy, t.dt);
    if (outcome === "next") next();
    else if (outcome === "prev") prev();
    else if (outcome === "close") onClose(Math.max(0, t.dy));
  };

  return {
    dragX,
    dragY,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: PointerEv) => endDrag(e),
      onPointerCancel: (e: PointerEv) => endDrag(e, true),
      onClickCapture: track.swallowClick,
    },
  };
}
