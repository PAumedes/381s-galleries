import { useMemo, useState } from "react";

import {
  bulkWarning,
  currentPicker,
  type BulkScope,
  type DlVariant,
} from "../lib/download-client";
import { BulkChooseView, BulkProgressView } from "./DownloadBulkViews";
import type { DownloadMenuProps, DownloadMode } from "./download-menu-types";
import { enabledSizes, hasVariant } from "./download-sizes";
import { useBulkFocus } from "./use-bulk-focus";
import { useBulkRun } from "./use-bulk-run";

export function BulkBody({
  gallery,
  t,
  ensure,
  onClose,
  mode,
  runningRef,
  confirming,
  setConfirming,
}: DownloadMenuProps & {
  mode: Extract<DownloadMode, { kind: "bulk" }>;
  runningRef: { current: boolean };
  confirming: boolean;
  setConfirming: (v: boolean) => void;
}) {
  const sizes = enabledSizes(gallery);
  const { photos, activeSet, favoriteIds } = mode;
  const [scope, setScope] = useState<BulkScope>("all");
  const [variant, setVariant] = useState<DlVariant>(
    sizes[0]?.variant ?? "highres",
  );

  const scopes: { key: BulkScope; label: string }[] = [
    { key: "all", label: t("download.scopeAll") },
    ...(activeSet
      ? [
          {
            key: "set" as const,
            label: t("download.scopeSet", { set: activeSet }),
          },
        ]
      : []),
    ...(favoriteIds.size > 0
      ? [{ key: "favorites" as const, label: t("download.scopeFavorites") }]
      : []),
  ];

  const count = useMemo(
    () =>
      photos.filter(
        (p) =>
          hasVariant(p, variant) &&
          (scope === "all" ||
            (scope === "set" ? p.set === activeSet : favoriteIds.has(p.id))),
      ).length,
    [photos, variant, scope, activeSet, favoriteIds],
  );
  const warning = bulkWarning({
    count,
    variant,
    picker: Boolean(currentPicker()),
  });

  const run = useBulkRun({
    slug: gallery.slug,
    ensure,
    scope,
    variant,
    activeSet,
    photos,
    count,
    warning,
    runningRef,
  });
  const { cancelRef, noRef, closeBtnRef, startRef } = useBulkFocus(
    run.phase,
    confirming,
  );

  if (run.phase !== "choose") {
    return (
      <BulkProgressView
        t={t}
        phase={run.phase}
        progress={run.progress}
        status={run.status}
        fallback={run.fallback}
        confirming={confirming}
        setConfirming={setConfirming}
        onAbort={run.abort}
        onClose={onClose}
        noRef={noRef}
        cancelRef={cancelRef}
        closeBtnRef={closeBtnRef}
      />
    );
  }

  return (
    <BulkChooseView
      t={t}
      scopes={scopes}
      scope={scope}
      setScope={setScope}
      sizes={sizes}
      variant={variant}
      setVariant={setVariant}
      count={count}
      warning={warning}
      error={run.error}
      startRef={startRef}
      disabled={count === 0 || run.phase !== "choose"}
      onStart={() => void run.start().catch(() => run.setError(true))}
    />
  );
}
