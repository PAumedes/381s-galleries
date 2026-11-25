import type { GalleryMode } from "../../../lib/constants";
import { useId, useMemo, useState } from "react";
import { useNavigation, useSearchParams } from "react-router";

import type { Design } from "../../../lib/design";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import { versionsOf } from "../../img-url";
import { isEditorTab, type EditorTab } from "../GalleryTabs";
import { usePendingCover, withPendingCover } from "../optimistic-cover";
import { usePreviewDevice } from "../use-preview-device";
import { resolveEditorCover } from "./cover";
import type { GalleryEditData } from "./types";
import { useCoverPrefetch } from "./useCoverPrefetch";
import { useDesignDraft } from "./useDesignDraft";

/** The gallery with a just-chosen cover applied at once (the server confirms, or it rolls back). */
function usePendingGallery(
  data: GalleryEditData,
  actionData: GalleryActionResult | undefined,
) {
  const photoIds = useMemo(
    () => new Set(data.photos.map((p) => p.id)),
    [data.photos],
  );
  const noWmIds = useMemo(
    () =>
      new Set(
        data.gallery.mode === "proofing"
          ? data.photos.filter((p) => p.hasWm === false).map((p) => p.id)
          : [],
      ),
    [data.photos, data.gallery.mode],
  );
  const pendingCover = usePendingCover(photoIds, actionData, noWmIds);
  return { g: withPendingCover(data.gallery, pendingCover), pendingCover };
}

/**
 * The editor's local state: the active tab, the gallery with any pending
 * (optimistic) cover applied, and the unsaved title / mode / design / device
 * the previews show. The view is keyed by gallery id, so none of it survives
 * a navigation between two galleries.
 */
export function useGalleryEditorState(
  data: GalleryEditData,
  actionData: GalleryActionResult | undefined,
) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [params] = useSearchParams();
  const rawTab = params.get("tab");
  const tab: EditorTab = isEditorTab(rawTab) ? rawTab : "datos";
  const { g, pendingCover } = usePendingGallery(data, actionData);
  const versions = useMemo(() => versionsOf(data.photos), [data.photos]);
  const [mode, setMode] = useState<GalleryMode>(g.mode);
  const proofing = mode === "proofing";
  useCoverPrefetch(pendingCover, { proofing, versions });
  const [title, setTitle] = useState(g.title);
  const [eventDate, setEventDate] = useState(g.eventDate ?? "");
  const saved: Design = {
    palette: g.palette,
    coverLayout: g.coverLayout,
    gridStyle: g.gridStyle,
    gridGap: g.gridGap,
  };
  const draft = useDesignDraft(saved);
  // One device for every preview of the editor (switching tabs keeps it).
  const [device, setDevice] = usePreviewDevice();
  const designFormId = useId();
  const previewState = {
    title,
    eventDate,
    design: draft.design,
    proofing,
    versions,
    device,
    onDevice: setDevice,
  };
  return {
    busy,
    tab,
    g,
    proofing,
    setMode,
    title,
    setTitle,
    eventDate,
    setEventDate,
    draft,
    device,
    designFormId,
    cover: resolveEditorCover(g, data.photos),
    previewState,
  };
}
