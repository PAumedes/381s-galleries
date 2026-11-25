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

type BulkBodyProps = DownloadMenuProps & {
  mode: Extract<DownloadMode, { kind: "bulk" }>;
  runningRef: { current: boolean };
  confirming: boolean;
  setConfirming: (v: boolean) => void;
};
type BulkMode = BulkBodyProps["mode"];

/** The scopes on offer: everything, the open set (when one is open) and the favourites (when any). */
function scopeOptions(t: DownloadMenuProps["t"], mode: BulkMode) {
  const { activeSet, favoriteIds } = mode;
  const scopes: { key: BulkScope; label: string }[] = [
    { key: "all", label: t("download.scopeAll") },
  ];
  if (activeSet)
    scopes.push({
      key: "set",
      label: t("download.scopeSet", { set: activeSet }),
    });
  if (favoriteIds.size > 0)
    scopes.push({ key: "favorites", label: t("download.scopeFavorites") });
  return scopes;
}

/** Photos that have a file in `variant` within `scope`. */
function countInScope(
  photos: BulkMode["photos"],
  activeSet: string | null,
  favoriteIds: BulkMode["favoriteIds"],
  variant: DlVariant,
  scope: BulkScope,
) {
  return photos.filter(
    (p) =>
      hasVariant(p, variant) &&
      (scope === "all" ||
        (scope === "set" ? p.set === activeSet : favoriteIds.has(p.id))),
  ).length;
}

/** What the visitor picks before downloading (scope, size) and what that means (count, warning). */
function useBulkChoices({ gallery, t, mode }: BulkBodyProps) {
  const sizes = enabledSizes(gallery);
  const [scope, setScope] = useState<BulkScope>("all");
  const [variant, setVariant] = useState<DlVariant>(
    sizes[0]?.variant ?? "highres",
  );
  const { photos, activeSet, favoriteIds } = mode;
  const count = useMemo(
    () => countInScope(photos, activeSet, favoriteIds, variant, scope),
    [photos, variant, scope, activeSet, favoriteIds],
  );
  const warning = bulkWarning({
    count,
    variant,
    picker: Boolean(currentPicker()),
  });
  return {
    sizes,
    scope,
    setScope,
    variant,
    setVariant,
    scopes: scopeOptions(t, mode),
    count,
    warning,
  };
}

export function BulkBody(props: BulkBodyProps) {
  const { gallery, t, ensure, onClose, mode, confirming } = props;
  const { photos, activeSet } = mode;
  const c = useBulkChoices(props);

  const run = useBulkRun({
    slug: gallery.slug,
    ensure,
    scope: c.scope,
    variant: c.variant,
    activeSet,
    photos,
    count: c.count,
    warning: c.warning,
    runningRef: props.runningRef,
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
        setConfirming={props.setConfirming}
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
      scopes={c.scopes}
      scope={c.scope}
      setScope={c.setScope}
      sizes={c.sizes}
      variant={c.variant}
      setVariant={c.setVariant}
      count={c.count}
      warning={c.warning}
      error={run.error}
      startRef={startRef}
      disabled={c.count === 0 || run.phase !== "choose"}
      onStart={() => void run.start().catch(() => run.setError(true))}
    />
  );
}
