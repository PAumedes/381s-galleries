import { useLayoutEffect, useRef, useState } from "react";
import { useNavigation } from "react-router";

import { useT } from "../../i18n/use-t";
import { movePhoto, moveTo, sortPhotos } from "../../lib/admin-gallery";
import type { MoveDir } from "../../lib/admin-gallery";
import type { GalleryActionResult } from "../../lib/server/admin-galleries";
import { GRID_BY_SIZE, useFitPrefs } from "./photo-fit";
import { FitControls } from "./FitControls";
import { PhotoViewer } from "./PhotoViewer";
import { QuickLook, useQuickLook } from "./QuickLook";
import { ReorderTile } from "./ReorderTile";
import { ReorderSaveBar, SetToolbar } from "./ReorderBars";

export interface ReorderPhoto {
  id: string;
  set: string;
  name: string;
  takenAt: string | null;
  /** Admin image token (`?v=`), when known. */
  v?: string | null;
}

type Orders = Record<string, string[]>;

function groupBySet(photos: ReorderPhoto[]): Orders {
  const out: Orders = {};
  for (const p of photos) (out[p.set] ??= []).push(p.id);
  return out;
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
export function PhotoReorder({
  photos,
  version,
  coverPhotoId = null,
  coverAuto = false,
  mobileCoverId = null,
  actionData,
}: {
  photos: ReorderPhoto[];
  version: string;
  /** Effective desktop cover (chosen, else the first photo): one badge. */
  coverPhotoId?: string | null;
  /** The cover is automatic (no explicit choice): the badge's label says so. */
  coverAuto?: boolean;
  /** Explicit mobile cover, if any: its own badge. */
  mobileCoverId?: string | null;
  actionData?: GalleryActionResult;
}) {
  const t = useT();
  const [initial] = useState<Orders>(() => groupBySet(photos));
  const [orders, setOrders] = useState<Orders>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const dragging = useRef<string | null>(null);
  const focusId = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [prefs, setPrefs] = useFitPrefs();
  const quick = useQuickLook();
  const busy = useNavigation().state !== "idle";

  const byId = new Map(photos.map((p) => [p.id, p]));
  const setOf = (id: string) => byId.get(id)?.set;
  const dirty = JSON.stringify(orders) !== JSON.stringify(initial);
  const flat = Object.values(orders).flat();

  useLayoutEffect(() => {
    if (!focusId.current) return;
    const id = focusId.current;
    focusId.current = null;
    Array.from(
      root.current?.querySelectorAll<HTMLElement>("[data-photo-id]") ?? [],
    )
      .find((li) => li.dataset.photoId === id)
      ?.querySelector<HTMLElement>("[role=button]")
      ?.focus();
  });

  function apply(set: string, ids: string[], moved?: string, refocus = true) {
    setOrders((o) => ({ ...o, [set]: ids }));
    if (moved) {
      if (refocus) focusId.current = moved;
      setAnnounce(
        t("admin.reorder.moved", {
          name: byId.get(moved)?.name ?? "",
          pos: ids.indexOf(moved) + 1,
          total: ids.length,
        }),
      );
    }
  }
  function move(id: string, dir: MoveDir, refocus = true) {
    const set = setOf(id);
    if (!set) return;
    apply(set, movePhoto(orders[set], id, dir), id, refocus);
  }
  function sortSet(set: string, mode: "date" | "name") {
    const list = orders[set].map((id) => byId.get(id)!);
    apply(
      set,
      sortPhotos(list, mode).map((p) => p.id),
    );
    setAnnounce(
      t(
        mode === "date"
          ? "admin.reorder.sortedDate"
          : "admin.reorder.sortedName",
        { set },
      ),
    );
  }

  function onKey(ev: React.KeyboardEvent, id: string) {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      setSelected((s) => (s === id ? null : id));
    } else if (ev.key === "Escape") {
      setSelected(null);
    } else if (selected === id) {
      const dir: MoveDir | null =
        ev.key === "ArrowRight" || ev.key === "ArrowDown"
          ? "after"
          : ev.key === "ArrowLeft" || ev.key === "ArrowUp"
            ? "before"
            : ev.key === "Home"
              ? "start"
              : ev.key === "End"
                ? "end"
                : null;
      if (dir) {
        ev.preventDefault();
        move(id, dir);
      }
    }
  }

  const feedback = actionData?.intent === "reorder" ? actionData : undefined;
  const coverLabel = coverAuto
    ? t("admin.reorder.coverAutoBadge")
    : t("admin.reorder.cover");

  return (
    <div ref={root} className="flex flex-col gap-8">
      <p className="text-small text-grey-600 max-w-prose">
        {t("admin.reorder.help")}
      </p>
      <p role="status" className="sr-only">
        {announce}
      </p>
      <FitControls prefs={prefs} onChange={setPrefs} />

      {Object.entries(orders).map(([set, ids]) => {
        const idx = selected ? ids.indexOf(selected) : -1;
        return (
          <fieldset key={set} className="flex min-w-0 flex-col gap-3">
            <legend className="sr-only">{set}</legend>
            <SetToolbar
              set={set}
              count={ids.length}
              canBefore={idx > 0}
              canAfter={idx !== -1 && idx !== ids.length - 1}
              onBefore={() => selected && move(selected, "before", false)}
              onAfter={() => selected && move(selected, "after", false)}
              onSort={(mode) => sortSet(set, mode)}
            />
            <ul
              data-set={set}
              className={`grid gap-1.5 ${GRID_BY_SIZE[prefs.size]}`}
            >
              {ids.map((id, i) => (
                <ReorderTile
                  key={id}
                  id={id}
                  index={i}
                  photo={byId.get(id)!}
                  selected={selected === id}
                  isCover={coverPhotoId === id}
                  isMobile={mobileCoverId === id}
                  coverLabel={coverLabel}
                  coverAuto={coverAuto}
                  prefs={prefs}
                  busy={busy}
                  quick={quick}
                  dnd={{
                    onDragStart: (ev) => {
                      dragging.current = id;
                      ev.dataTransfer?.setData?.("text/plain", id);
                      if (ev.dataTransfer)
                        ev.dataTransfer.effectAllowed = "move";
                    },
                    onDragOver: (ev) => {
                      const d = dragging.current;
                      if (d && d !== id && setOf(d) === set) {
                        ev.preventDefault();
                        if (ev.dataTransfer)
                          ev.dataTransfer.dropEffect = "move";
                      }
                    },
                    onDrop: (ev) => {
                      const d = dragging.current;
                      dragging.current = null;
                      if (!d || d === id || setOf(d) !== set) return;
                      ev.preventDefault();
                      apply(
                        set,
                        moveTo(ids, ids.indexOf(d), ids.indexOf(id)),
                        d,
                      );
                    },
                    onDragEnd: () => {
                      dragging.current = null;
                    },
                  }}
                  onToggle={() => setSelected((s) => (s === id ? null : id))}
                  onKey={(ev) => onKey(ev, id)}
                  onView={() => {
                    quick.stop();
                    setViewing(id);
                  }}
                />
              ))}
            </ul>
          </fieldset>
        );
      })}

      {/* The save bar stays in view while the order has unsaved changes. */}
      <ReorderSaveBar
        version={version}
        orders={orders}
        dirty={dirty}
        busy={busy}
        onReset={() => {
          setOrders(initial);
          setSelected(null);
          setAnnounce(t("admin.reorder.wasReset"));
        }}
      />
      {feedback && !feedback.ok && (
        <p role="alert" className="border-ink border p-3 text-small">
          {feedback.error}{" "}
          {feedback.stale && (
            <a href="?" className="underline">
              {t("admin.reorder.reload")}
            </a>
          )}
        </p>
      )}
      {feedback?.ok && (
        <p className="text-small text-grey-700">{feedback.message}</p>
      )}

      <QuickLook look={quick.look} />

      {viewing && (
        <PhotoViewer
          ids={flat}
          names={byId}
          current={viewing}
          onChange={setViewing}
          onClose={() => {
            quick.quiet();
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}
