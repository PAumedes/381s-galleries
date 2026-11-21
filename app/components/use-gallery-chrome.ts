import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";

import type { TKey } from "../i18n/t";

export const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** One toast slot: a newer message replaces the current one; it clears itself. */
export function useToast() {
  const [toast, setToast] = useState<{ key: TKey; n: number } | null>(null);
  const showToast = useCallback(
    (key: TKey) => setToast((cur) => ({ key, n: (cur?.n ?? 0) + 1 })),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(
      () => setToast(null),
      toast.key === "gallery.linkCopied" ? 2000 : 3000,
    );
    return () => clearTimeout(id);
  }, [toast]);
  return { toast, showToast };
}

/** True while the top bar should be hidden: scrolling down past the cover. */
export function useHideOnScroll(coverRef: RefObject<HTMLElement | null>) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const past = y > (coverRef.current?.offsetHeight ?? 0);
      if (Math.abs(y - last) > 6) {
        setHidden(past && y > last);
        last = y;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [coverRef]);
  return hidden;
}

/**
 * Fade mask state for the tab row (which edge has more tabs beyond it); also
 * keeps the active tab in view (horizontal only: never scrolls the page).
 */
export function useTabEdges(
  tabsRef: RefObject<HTMLElement | null>,
  active: string,
) {
  const [edges, setEdges] = useState({ start: false, end: false });
  const updateEdges = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, [tabsRef]);
  useEffect(() => {
    const list = tabsRef.current;
    const tab = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (list && tab && typeof list.scrollTo === "function")
      list.scrollTo({
        left: tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2,
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    updateEdges();
  }, [tabsRef, active, updateEdges]);
  useEffect(() => {
    window.addEventListener("resize", updateEdges);
    return () => window.removeEventListener("resize", updateEdges);
  }, [updateEdges]);
  return { edges, updateEdges };
}
