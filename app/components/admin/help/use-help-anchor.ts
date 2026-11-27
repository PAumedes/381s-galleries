import { useEffect } from "react";
import { useLocation } from "react-router";

/**
 * A link such as /admin/ayuda#albums-publish opens that answer and brings it
 * into view (a browser alone scrolls to a closed details but never opens it).
 */
export function useHelpAnchor() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep the raw text */
    }
    const el = document.getElementById(id);
    if (!(el instanceof HTMLDetailsElement)) return;
    el.open = true;
    el.scrollIntoView?.({ block: "start" });
  }, [hash]);
}
