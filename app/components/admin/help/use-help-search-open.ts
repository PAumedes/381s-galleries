import { useEffect, useRef } from "react";

/**
 * While searching, answers that newly match open by themselves (the owner sees
 * the answer at once). Each one opens once: a question the reader closes stays
 * closed while typing goes on. When the search is cleared, only what the
 * search itself opened closes again; answers opened by hand stay open.
 */
export function useHelpSearchOpen(ids: readonly string[], searching: boolean) {
  const seen = useRef(new Set<string>());
  const opened = useRef(new Set<string>());
  useEffect(() => {
    if (!searching) {
      for (const id of opened.current) {
        const el = document.getElementById(id);
        if (el instanceof HTMLDetailsElement) el.open = false;
      }
      opened.current.clear();
      seen.current.clear();
      return;
    }
    // A question that stopped matching opens again if it matches later.
    for (const id of seen.current)
      if (!ids.includes(id)) seen.current.delete(id);
    for (const id of ids) {
      if (seen.current.has(id)) continue;
      seen.current.add(id);
      const el = document.getElementById(id);
      if (el instanceof HTMLDetailsElement && !el.open) {
        el.open = true;
        opened.current.add(id);
      }
    }
  }, [ids, searching]);
}
