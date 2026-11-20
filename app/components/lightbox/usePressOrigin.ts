import {
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { isZoomed } from "./useZoomed";

const TOP_BAR_PX = 64;
const SIDE_ZONE_FRACTION = 0.18; // slightly wider than the 15vw arrows
const EDGE_TAP_FRACTION = 0.25; // touch: tap this much of each side to go on

/**
 * Backdrop click rule: closes only on clearly empty backdrop, that is the
 * stage itself (not the photo, shield or a control), horizontally between the
 * two navigation zones and below the top bar. A miss near an arrow or the
 * controls does nothing instead of closing.
 */
const isEmptyBackdrop = (
  e: { target: EventTarget; currentTarget: EventTarget },
  x: number,
  y: number,
) => {
  if (e.target !== e.currentTarget) return false;
  const w = window.innerWidth;
  return (
    x > w * SIDE_ZONE_FRACTION &&
    x < w - w * SIDE_ZONE_FRACTION &&
    y > TOP_BAR_PX
  );
};

type EdgeNav = {
  prev: () => void;
  next: () => void;
};

/**
 * Backdrop close needs the press to have started on empty backdrop too. A
 * touch tap on the outer quarter of the stage goes previous/next instead (a
 * drag never reaches here: its click is swallowed by the swipe handler).
 */
export function usePressOrigin(
  stageRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  edge: EdgeNav,
) {
  const touchPress = useRef(false);
  // null: no press seen, e.g. a synthetic click.
  const pressOk = useRef<boolean | null>(null);
  const notePress = (e: ReactMouseEvent | ReactPointerEvent) => {
    // Only pointer events know the device; the compat mouse events that
    // follow a touch must not reset it.
    if ("pointerType" in e) touchPress.current = e.pointerType !== "mouse";
    pressOk.current = isEmptyBackdrop(
      { target: e.target, currentTarget: stageRef.current as EventTarget },
      e.clientX,
      e.clientY,
    );
  };
  const onStageClick = (e: ReactMouseEvent<HTMLElement>) => {
    const pressed = pressOk.current;
    pressOk.current = null;
    if (touchPress.current && e.clientY > TOP_BAR_PX) {
      const w = window.innerWidth;
      const side =
        e.clientX < w * EDGE_TAP_FRACTION
          ? "prev"
          : e.clientX > w * (1 - EDGE_TAP_FRACTION)
            ? "next"
            : null;
      // Zoomed: the sides belong to panning; a tap there does nothing.
      if (side && isZoomed()) return;
      if (side) return void (side === "prev" ? edge.prev() : edge.next());
    }
    if (pressed !== false && isEmptyBackdrop(e, e.clientX, e.clientY))
      onClose();
  };
  return { notePress, onStageClick };
}
