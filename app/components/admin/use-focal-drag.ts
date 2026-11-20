import { useEffect, useRef, useState } from "react";

export type Focus = { x: number; y: number };

export const clamp = (n: number) => Math.min(100, Math.max(0, n));
export const round1 = (n: number) => Math.round(n * 10) / 10;

/** The point of `box` under a pointer, as percent of its width/height. */
export function focusAt(
  box: DOMRect,
  clientX: number,
  clientY: number,
): Focus | null {
  if (!box.width || !box.height) return null;
  return {
    x: round1(clamp(((clientX - box.left) / box.width) * 100)),
    y: round1(clamp(((clientY - box.top) / box.height) * 100)),
  };
}

/**
 * Drag the focal point with a finger or pen (a mouse keeps using `click`).
 * Pointer down sets the point and captures the pointer; moves follow it;
 * release calls `onCommit` with the final point, but only after a real drag
 * (a plain tap just sets the point). While dragging the page must not
 * scroll: `touchAction: none` is applied then (and only then), and, because
 * a touch that already started keeps its scroll behaviour, a non-passive
 * `touchmove` listener cancels the browser's pan for the gesture.
 */
export function useFocalDrag({
  onPoint,
  onCommit,
}: {
  onPoint: (f: Focus) => void;
  onCommit: (f: Focus) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const active = useRef<{ id: number; last: Focus; moved: boolean } | null>(
    null,
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: TouchEvent) => {
      if (active.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, []);

  const end = () => {
    active.current = null;
    setDragging(false);
  };

  return {
    ref,
    dragging,
    handlers: {
      onPointerDown(e: React.PointerEvent<HTMLElement>) {
        if (e.pointerType === "mouse" || !e.isPrimary) return;
        const f = focusAt(
          e.currentTarget.getBoundingClientRect(),
          e.clientX,
          e.clientY,
        );
        if (!f) return;
        active.current = { id: e.pointerId, last: f, moved: false };
        // Before React re-renders: the browser reads touch-action now.
        e.currentTarget.style.touchAction = "none";
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDragging(true);
        onPoint(f);
      },
      onPointerMove(e: React.PointerEvent<HTMLElement>) {
        const a = active.current;
        if (!a || a.id !== e.pointerId) return;
        const f = focusAt(
          e.currentTarget.getBoundingClientRect(),
          e.clientX,
          e.clientY,
        );
        if (!f) return;
        a.last = f;
        a.moved = true;
        onPoint(f);
      },
      onPointerUp(e: React.PointerEvent<HTMLElement>) {
        const a = active.current;
        if (!a || a.id !== e.pointerId) return;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        end();
        if (a.moved) onCommit(a.last);
      },
      onPointerCancel(e: React.PointerEvent<HTMLElement>) {
        if (active.current?.id === e.pointerId) end();
      },
    },
  };
}
