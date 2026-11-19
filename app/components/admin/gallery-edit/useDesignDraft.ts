import { useEffect, useState } from "react";
import { useBlocker } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { Design } from "../../../lib/design";

/**
 * The design being edited (not yet saved) against the saved baseline, with the
 * leave guard: another page, the list or a reload with unsaved changes asks
 * first. Tabs and the save submit stay on the same pathname.
 */
export function useDesignDraft(saved: Design) {
  const t = useT();
  const [design, setDesign] = useState<Design>(saved);
  // A saved design coming back from the server becomes the new baseline.
  const savedKey = JSON.stringify(saved);
  const [seenSaved, setSeenSaved] = useState(savedKey);
  if (seenSaved !== savedKey) {
    setSeenSaved(savedKey);
    setDesign(saved);
  }
  const dirty = JSON.stringify(design) !== savedKey;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  const leaveMsg = t("admin.design.leaveConfirm");
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(leaveMsg)) blocker.proceed();
    else blocker.reset();
  }, [blocker, leaveMsg]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return {
    design,
    setDesign,
    dirty,
    discard: () => setDesign(JSON.parse(savedKey) as Design),
  };
}
