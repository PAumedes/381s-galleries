import { useEffect, type RefObject } from "react";

/** Focus in, restore on unmount; lock body scroll. */
export function useModalLock(initialFocus: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    initialFocus.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener && opener !== document.body && opener.isConnected) {
        opener.focus();
      }
    };
  }, [initialFocus]);
}
