import { useEffect, useRef, useState } from "react";

import type { TKey } from "../i18n/t";
import {
  downloadBulk,
  type BulkProgress,
  type BulkScope,
  type DlVariant,
} from "../lib/download-client";
import type { BulkPhase } from "./DownloadBulkViews";
import { EmailRequiredError } from "./use-visitor";
import type { GalleryPhoto } from "./types";

export interface BulkRunInput {
  slug: string;
  ensure: (action: () => void | Promise<void>) => Promise<void>;
  scope: BulkScope;
  variant: DlVariant;
  activeSet: string | null;
  photos: readonly GalleryPhoto[];
  /** Photos the run will zip (what the choose view showed). */
  count: number;
  /** "large": the size warning was already shown, so no second prompt. */
  warning: string | null | undefined;
  /** Kept `true` while a run is going (the menu asks before closing). */
  runningRef: { current: boolean };
}

/** State and start/abort of one bulk-download run (the zip fetch and its prompts). */
export function useBulkRun(input: BulkRunInput) {
  const { runningRef } = input;
  const [phase, setPhase] = useState<BulkPhase>("choose");
  const [progress, setProgress] = useState<BulkProgress>({
    done: 0,
    total: 0,
    bytes: 0,
    failed: [],
  });
  const [status, setStatus] = useState<"done" | "cancelled">("done");
  const [error, setError] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const started = useRef(false);
  const live = useRef(false);
  // A yes/no question to the visitor while running (save dialog failed / large in-memory zip).
  const [fallback, setFallback] = useState<{
    key: TKey;
    answer: (ok: boolean) => void;
  } | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  useEffect(() => {
    runningRef.current = phase === "running";
  }, [phase, runningRef]);

  const ask = (key: TKey) =>
    new Promise<boolean>((resolve) =>
      setFallback({
        key,
        answer: (ok: boolean) => {
          setFallback(null);
          resolve(ok);
        },
      }),
    );

  const start = () => {
    if (started.current) return Promise.resolve();
    started.current = true;
    // `ensure` runs the action synchronously unless it opens the email gate;
    // only a direct click may open the save picker, so a gate-resumed action
    // does nothing and the visitor presses Download again.
    live.current = true;
    const { slug, scope, variant, activeSet, photos, count, warning } = input;
    const p = input.ensure(async () => {
      if (!live.current) {
        started.current = false;
        return;
      }
      const c = new AbortController();
      ctl.current = c;
      setError(false);
      setProgress({ done: 0, total: count, bytes: 0, failed: [] });
      setPhase("running");
      try {
        const r = await downloadBulk({
          slug,
          scope,
          ...(scope === "set" && activeSet ? { set: activeSet } : {}),
          variant,
          signal: c.signal,
          sets: new Map(photos.map((p) => [p.id, p.set])),
          onProgress: setProgress,
          confirmFallback: () => ask("download.pickerFailed"),
          ...(warning === "large"
            ? {}
            : { confirmLarge: () => ask("download.warnLarge") }),
        });
        setProgress({ ...r });
        setStatus(r.status);
        setPhase("done");
      } catch (err) {
        started.current = false;
        setPhase("choose");
        if (err instanceof EmailRequiredError) throw err;
        setError(true);
      }
    });
    live.current = false;
    return p;
  };

  return {
    phase,
    progress,
    status,
    error,
    setError,
    fallback,
    start,
    abort: () => ctl.current?.abort(),
  };
}
