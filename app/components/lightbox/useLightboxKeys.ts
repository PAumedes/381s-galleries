import { useEffect, type RefObject } from "react";

import { trapTab } from "./focus-trap";

/** Escape, arrows and the Tab trap, on the document while the lightbox is open. */
export function useLightboxKeys(
  dialogRef: RefObject<HTMLElement | null>,
  close: () => void,
  prev: () => void,
  next: () => void,
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A sheet/modal opened above the lightbox owns the keyboard.
      const other =
        (e.target as Element | null)?.closest?.('[role="dialog"]') ??
        document.activeElement?.closest?.('[role="dialog"]');
      if (other && other !== dialogRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
        if (e.key === "ArrowLeft") prev();
        else next();
      } else if (e.key === "Tab") {
        trapTab(e, dialogRef.current);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialogRef, close, prev, next]);
}
