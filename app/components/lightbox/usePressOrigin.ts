import {
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

const TOP_BAR_PX = 64;
const SIDE_ZONE_FRACTION = 0.18; // slightly wider than the 15vw arrows

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

/** Backdrop close needs the press to have started on empty backdrop too. */
export function usePressOrigin(
  stageRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  // null: no press seen, e.g. a synthetic click.
  const pressOk = useRef<boolean | null>(null);
  const notePress = (e: ReactMouseEvent | ReactPointerEvent) => {
    pressOk.current = isEmptyBackdrop(
      { target: e.target, currentTarget: stageRef.current as EventTarget },
      e.clientX,
      e.clientY,
    );
  };
  const onStageClick = (e: ReactMouseEvent<HTMLElement>) => {
    const pressed = pressOk.current;
    pressOk.current = null;
    if (pressed !== false && isEmptyBackdrop(e, e.clientX, e.clientY))
      onClose();
  };
  return { notePress, onStageClick };
}
