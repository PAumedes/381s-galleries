import { useEffect, useRef, type RefObject } from "react";

import { canAnimate, exitDown } from "./motion";

/**
 * Swipe-down close: the photo slides off the bottom and the backdrop fades
 * before `onClose` runs (the parent unmounts the lightbox). Without Web
 * Animations, or with reduced motion, it closes at once.
 */
export function useAnimatedClose(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  const closing = useRef(false);
  return (fromY: number) => {
    const root = dialogRef.current;
    if (!root || !canAnimate()) return onClose();
    if (closing.current) return;
    closing.current = true;
    void exitDown(root, fromY).then(() => latest.current());
  };
}
