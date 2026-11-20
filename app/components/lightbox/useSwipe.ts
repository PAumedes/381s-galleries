import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { isZoomed } from "./useZoomed";

const SWIPE_DISTANCE = 50;
const SWIPE_VELOCITY = 0.5; // px per ms
const SWIPE_MIN_FAST = 20;
const CLOSE_DISTANCE = 80;
const DRAG_SLOP = 10;

type SwipeInput = {
  hasPrev: boolean;
  hasNext: boolean;
  prev: () => void;
  next: () => void;
  onClose: () => void;
};

/**
 * Touch gestures on the dialog root: horizontal swipe navigates, a downward
 * swipe closes, the photo follows the finger (`dragX`). Mouse is ignored and
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
  const pointers = useRef(new Set<number>());
  const drag = useRef<{ x: number; y: number; t: number; id: number } | null>(
    null,
  );
  // Set once a touch drag passes the slop; swallows the trailing click.
  const dragged = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragged.current = false;
    if (e.pointerType === "mouse") return;
    pointers.current.add(e.pointerId);
    if (pointers.current.size > 1 || isZoomed()) {
      drag.current = null;
      setDragX(0);
      return;
    }
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      id: e.pointerId,
    };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > DRAG_SLOP && !dragged.current) {
      // Capture only once it is a drag, so a plain tap still clicks its target.
      dragged.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      const blocked = (dx > 0 && !hasPrev) || (dx < 0 && !hasNext);
      setDragX(blocked ? dx / 4 : dx);
    }
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragX(0);
    if (cancelled || isZoomed()) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const dt = Math.max(1, Date.now() - d.t);
    if (Math.abs(dx) > Math.abs(dy)) {
      const fast =
        Math.abs(dx) >= SWIPE_MIN_FAST && Math.abs(dx) / dt > SWIPE_VELOCITY;
      if (Math.abs(dx) >= SWIPE_DISTANCE || fast) {
        if (dx < 0) next();
        else prev();
      }
    } else if (
      dy >= CLOSE_DISTANCE ||
      (dy >= SWIPE_MIN_FAST * 2 && dy / dt > SWIPE_VELOCITY)
    ) {
      onClose();
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => endDrag(e);
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) =>
    endDrag(e, true);
  // The click that ends a touch swipe must not hit what was under it.
  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (dragged.current) {
      dragged.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return {
    dragX,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
    },
  };
}
