import { useRef, useState } from "react";
import { useNavigation } from "react-router";

import { useT } from "../../i18n/use-t";
import type { GalleryActionResult } from "../../lib/server/admin-galleries";
import { useFitPrefs, type FitPrefs } from "./photo-fit";
import { FitControls } from "./FitControls";
import { PhotoViewer } from "./PhotoViewer";
import { QuickLook, useQuickLook } from "./QuickLook";
import { ReorderSetGrid } from "./ReorderSetGrid";
import { ReorderSaveBar } from "./ReorderBars";
import { usePhotoOrder, type Orders } from "./use-photo-order";
import { useReorderDnd } from "./use-reorder-dnd";

export interface ReorderPhoto {
  id: string;
  set: string;
  name: string;
  takenAt: string | null;
  /** Admin image token (`?v=`), when known. */
  v?: string | null;
}

/**
 * "Fotos": a dense grid per set of tiles showing each whole picture
 * (letterboxed; "Rellenar" crops to a square instead). Mouse: drag a thumb onto another.
 * Keyboard/touch: Enter/Space (or tap) selects a photo, then arrow keys /
 * Home / End or the "Mover antes/después" buttons move it; Escape deselects.
 * Nothing is written until "Guardar orden". The current cover wears a small
 * badge (once); every tile has an icon + label action bar under the picture
 * (`TileActions`: cover, mobile cover, full view).
 */
type PhotoReorderProps = {
  photos: ReorderPhoto[];
  version: string;
  /** Effective desktop cover (chosen, else the first photo): one badge. */
  coverPhotoId?: string | null;
  /** The cover is automatic (no explicit choice): the badge's label says so. */
  coverAuto?: boolean;
  /** Explicit mobile cover, if any: its own badge. */
  mobileCoverId?: string | null;
  actionData?: GalleryActionResult;
};

/** The photo viewer: which photo is open; opening / closing keeps the quick look quiet. */
function useReorderViewer(quick: ReturnType<typeof useQuickLook>) {
  const [viewing, setViewing] = useState<string | null>(null);
  return {
    viewing,
    setViewing,
    open: (id: string) => {
      quick.stop();
      setViewing(id);
    },
    close: () => {
      quick.quiet();
      setViewing(null);
    },
  };
}

export function PhotoReorder(props: PhotoReorderProps) {
  const { photos, version, actionData } = props;
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const order = usePhotoOrder(photos, t, root);
  const { orders, byId } = order;
  const dndFor = useReorderDnd((id) => byId.get(id)?.set, order.apply);
  const [prefs, setPrefs] = useFitPrefs();
  const quick = useQuickLook();
  const viewer = useReorderViewer(quick);
  const busy = useNavigation().state !== "idle";

  return (
    <div ref={root} className="flex flex-col gap-8">
      <ReorderHeader
        announce={order.announce}
        prefs={prefs}
        onPrefs={setPrefs}
      />

      {Object.entries(orders).map(([set, ids]) => (
        <ReorderSetGrid
          key={set}
          set={set}
          ids={ids}
          order={order}
          dndFor={dndFor}
          prefs={prefs}
          busy={busy}
          quick={quick}
          cover={{
            coverId: props.coverPhotoId ?? null,
            mobileId: props.mobileCoverId ?? null,
            auto: props.coverAuto ?? false,
          }}
          onView={viewer.open}
        />
      ))}

      {/* The save bar stays in view while the order has unsaved changes. */}
      <ReorderSaveBar
        version={version}
        orders={orders}
        dirty={order.dirty}
        busy={busy}
        onReset={order.reset}
      />
      <ReorderFeedback
        feedback={actionData?.intent === "reorder" ? actionData : undefined}
      />

      <QuickLook look={quick.look} />

      <ReorderViewer viewer={viewer} orders={orders} names={byId} />
    </div>
  );
}

/** The full-size viewer over the photos of every set, while one is open. */
function ReorderViewer({
  viewer,
  orders,
  names,
}: {
  viewer: ReturnType<typeof useReorderViewer>;
  orders: Orders;
  names: ReturnType<typeof usePhotoOrder>["byId"];
}) {
  if (!viewer.viewing) return null;
  return (
    <PhotoViewer
      ids={Object.values(orders).flat()}
      names={names}
      current={viewer.viewing}
      onChange={viewer.setViewing}
      onClose={viewer.close}
    />
  );
}

/** Result of the last "Guardar orden": error (with a reload link when stale) or message. */
function ReorderFeedback({ feedback }: { feedback?: GalleryActionResult }) {
  const t = useT();
  if (!feedback) return null;
  if (feedback.ok)
    return <p className="text-small text-grey-700">{feedback.message}</p>;
  return (
    <p role="alert" className="border-ink border p-3 text-small">
      {feedback.error}{" "}
      {feedback.stale && (
        <a href="?" className="underline">
          {t("admin.reorder.reload")}
        </a>
      )}
    </p>
  );
}

/** Help text, the screen-reader live region and the fit controls. */
function ReorderHeader({
  announce,
  prefs,
  onPrefs,
}: {
  announce: string;
  prefs: FitPrefs;
  onPrefs: (p: Partial<FitPrefs>) => void;
}) {
  const t = useT();
  return (
    <>
      <p className="text-small text-grey-600 max-w-prose">
        {t("admin.reorder.help")}
      </p>
      <p role="status" className="sr-only">
        {announce}
      </p>
      <FitControls prefs={prefs} onChange={onPrefs} />
    </>
  );
}
