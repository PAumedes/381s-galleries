import { useEffect, useRef } from "react";

import type { BulkPhase } from "./DownloadBulkViews";

/** Keeps focus on the primary control of the current bulk-download phase. */
export function useBulkFocus(phase: BulkPhase, confirming: boolean) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (phase === "running") cancelRef.current?.focus();
    else if (phase === "done") closeBtnRef.current?.focus();
    else if (moved.current) startRef.current?.focus();
    moved.current = true;
  }, [phase]);
  const askedConfirm = useRef(false);
  useEffect(() => {
    if (confirming) {
      askedConfirm.current = true;
      noRef.current?.focus();
    } else if (askedConfirm.current) {
      askedConfirm.current = false;
      cancelRef.current?.focus();
    }
  }, [confirming]);
  return { cancelRef, noRef, closeBtnRef, startRef };
}
