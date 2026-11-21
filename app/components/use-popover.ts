import { useEffect } from "react";
import type { RefObject } from "react";

import { useLatest } from "./dialog-keys";

/**
 * While `open`: focuses the first link/button in the popover, Escape calls
 * `onEscape` (nothing underneath sees it) and a pointer press outside the
 * popover and its trigger calls `onOutside`.
 */
export function usePopoverDismiss(
  open: boolean,
  boxRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  onOutside: () => void,
) {
  const escapeRef = useLatest(onEscape);
  const outsideRef = useLatest(onOutside);
  useEffect(() => {
    if (!open) return;
    boxRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        escapeRef.current();
      }
    };
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!boxRef.current?.contains(n) && !triggerRef.current?.contains(n))
        outsideRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, boxRef, triggerRef, escapeRef, outsideRef]);
}

/** Selects the text of an input whenever `when` turns true. */
export function useSelectWhen(
  ref: RefObject<HTMLInputElement | null>,
  when: boolean,
) {
  useEffect(() => {
    if (when) ref.current?.select();
  }, [ref, when]);
}
