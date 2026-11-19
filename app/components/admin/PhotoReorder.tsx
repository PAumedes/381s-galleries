import { useLayoutEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";

import { useT } from "../../i18n/use-t";
import { movePhoto, moveTo, sortPhotos } from "../../lib/admin-gallery";
import type { MoveDir } from "../../lib/admin-gallery";
import type { GalleryActionResult } from "../../lib/server/admin-galleries";
import { adminImgSrc } from "../img-url";
import {
  FRAME_BY_MODE,
  GRID_BY_SIZE,
  IMG_BY_MODE,
  useFitPrefs,
} from "./photo-fit";
import { FitControls, TOOL_BTN as tool } from "./FitControls";
import { PhotoViewer } from "./PhotoViewer";
import { QuickLook, useQuickLook } from "./QuickLook";
import { TileActions, TileBadges } from "./TileActions";

export interface ReorderPhoto {
  id: string;
  set: string;
  name: string;
  takenAt: string | null;
  /** Admin image token (`?v=`), when known. */
  v?: string | null;
}

type Orders = Record<string, string[]>;

const btn =
  "text-micro uppercase border border-ink min-h-tap px-4 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:min-h-10";
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
            <div className="border-grey-200 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b pb-3">
              <p aria-hidden="true" className="flex items-baseline gap-2">
                <span className="text-micro text-ink uppercase">{set}</span>
                <span className="text-small text-grey-600">{ids.length}</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className={tool}
                  disabled={idx <= 0}
                  onClick={() => selected && move(selected, "before", false)}
                >
                  {t("admin.reorder.before")}
                </button>
                <button
                  type="button"
                  className={tool}
                  disabled={idx === -1 || idx === ids.length - 1}
                  onClick={() => selected && move(selected, "after", false)}
                >
                  {t("admin.reorder.after")}
                </button>
                <button
                  type="button"
                  className={tool}
                  onClick={() => sortSet(set, "date")}
                >
                  {t("admin.reorder.sortDate")}
                </button>
                <button
                  type="button"
                  className={tool}
                  onClick={() => sortSet(set, "name")}
                >
                  {t("admin.reorder.sortName")}
                </button>
              </div>
            </div>
            <ul
              data-set={set}
              className={`grid gap-1.5 ${GRID_BY_SIZE[prefs.size]}`}
            >
              {ids.map((id, i) => {
                const p = byId.get(id)!;
                const isSel = selected === id;
                const isCover = coverPhotoId === id;
                const isMobile = mobileCoverId === id;
                return (
                  <li
                    key={id}
                    data-photo-id={id}
                    draggable
                    onPointerEnter={(ev) =>
                      quick.hover(id, ev.currentTarget, ev.pointerType)
                    }
                    onPointerDownCapture={quick.pointerDown}
                    onPointerLeave={quick.stop}
                    onFocus={(ev) => quick.focus(id, ev.currentTarget)}
                    onBlur={quick.stop}
                    onDragStart={(ev) => {
                      dragging.current = id;
                      ev.dataTransfer?.setData?.("text/plain", id);
                      if (ev.dataTransfer)
                        ev.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(ev) => {
                      const d = dragging.current;
                      if (d && d !== id && setOf(d) === set) {
                        ev.preventDefault();
                        if (ev.dataTransfer)
                          ev.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(ev) => {
                      const d = dragging.current;
                      dragging.current = null;
                      if (!d || d === id || setOf(d) !== set) return;
                      ev.preventDefault();
                      apply(
                        set,
                        moveTo(ids, ids.indexOf(d), ids.indexOf(id)),
                        d,
                      );
                    }}
                    onDragEnd={() => {
                      dragging.current = null;
                    }}
                    className="group @container flex min-w-0 list-none flex-col gap-1"
                  >
                    <div
                      data-thumb-frame=""
                      onPointerEnter={(ev) =>
                        quick.hover(
                          id,
                          ev.currentTarget.parentElement!,
                          ev.pointerType,
                        )
                      }
                      className={`bg-grey-100 relative ${FRAME_BY_MODE[prefs.mode]} overflow-hidden ${isSel ? "outline-ink outline-2 outline-offset-2" : ""}`}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSel}
                        id={`photo-${id}`}
                        aria-label={p.name}
                        onClick={() =>
                          setSelected((s) => (s === id ? null : id))
                        }
                        onKeyDown={(ev) => onKey(ev, id)}
                        className="focus-visible:outline-ink absolute inset-0 cursor-grab outline-offset-2 focus-visible:outline-2"
                      >
                        <img
                          src={adminImgSrc(id, "thumb", p.v)}
                          alt={p.name}
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                          className={`size-full ${IMG_BY_MODE[prefs.mode]} select-none`}
                        />
                      </div>
                      <span
                        aria-hidden="true"
                        className="text-micro bg-paper/90 text-ink pointer-events-none absolute top-0 left-0 px-1.5 py-0.5"
                      >
                        {i + 1}
                      </span>
                      <TileBadges
                        isCover={isCover}
                        isMobile={isMobile}
                        coverLabel={coverLabel}
                      />
                    </div>
                    <span
                      aria-hidden="true"
                      className="text-grey-600 truncate text-[0.6875rem]"
                    >
                      {p.name}
                    </span>
                    <div
                      onPointerEnter={quick.stop}
                      onFocus={(ev) => ev.stopPropagation()}
                    >
                      <TileActions
                        id={id}
                        isCover={isCover}
                        coverAuto={coverAuto}
                        isMobile={isMobile}
                        busy={busy}
                        onView={() => {
                          quick.stop();
                          setViewing(id);
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}

      {/* The save bar stays in view while the order has unsaved changes. */}
      <Form
        method="post"
        className={`bg-paper border-grey-200 z-10 flex flex-wrap items-center gap-2 border-t py-3 ${dirty ? "sticky bottom-0" : ""}`}
      >
        <input type="hidden" name="intent" value="reorder" />
        <input type="hidden" name="version" value={version} />
        <input type="hidden" name="order" value={JSON.stringify(orders)} />
        <button
          type="submit"
          className={`${btn} bg-ink text-paper`}
          disabled={!dirty || busy}
        >
          {t("admin.reorder.save")}
        </button>
        <button
          type="button"
          className={btn}
          disabled={!dirty}
          onClick={() => {
            setOrders(initial);
            setSelected(null);
            setAnnounce(t("admin.reorder.wasReset"));
          }}
        >
          {t("admin.reorder.reset")}
        </button>
        {dirty && (
          <span className="text-small text-grey-700">
            {t("admin.reorder.unsaved")}
          </span>
        )}
      </Form>
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
