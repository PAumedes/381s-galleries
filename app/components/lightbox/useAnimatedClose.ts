import { useCallback, useEffect, useRef, type RefObject } from "react";

import { canAnimate, exitDown } from "./motion";

/**
 * Close with a guard: `onClose` runs once, never after unmount, and while the
 * swipe-down exit plays (`closing`) every other close, navigation or swipe is
 * ignored. `closeFrom(y)` is the animated close (the photo slides off the
 * bottom, the backdrop fades); without Web Animations, or with reduced
 * motion, it closes at once.
 */
export function useAnimatedClose(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const closing = useRef(false); // exit animation started
  const called = useRef(false); // onClose already ran for that exit

  const close = useCallback(() => {
    if (closing.current && called.current) return;
    called.current = true;
    latest.current();
  }, []);

  const closeFrom = useCallback(
    (fromY: number) => {
      const root = dialogRef.current;
      if (closing.current) return;
      if (!root || !canAnimate()) return close();
      closing.current = true;
      void exitDown(root, fromY).then(() => {
        if (mounted.current) close();
      });
    },
    [dialogRef, close],
  );
  return { close, closeFrom, closing };
}
