import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export const FOCUSABLE = "button:not([disabled]), input:not([disabled])";

/** Keeps Tab / Shift+Tab inside `container` (wraps first <-> last). */
export function trapTab(e: KeyboardEvent, container: HTMLElement | null) {
  const nodes = Array.from(
    container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
  );
  if (nodes.length === 0) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (!container?.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/** A ref that always holds the latest value (for listeners bound once). */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Focus goes back to whatever opened the dialog when it unmounts. */
export function restoreFocus(opener: HTMLElement | null) {
  if (opener && opener !== document.body && opener.isConnected) opener.focus();
}
