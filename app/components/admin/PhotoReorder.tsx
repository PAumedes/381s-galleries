import { useLayoutEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";

import { useT } from "../../i18n/use-t";
import { movePhoto, moveTo, sortPhotos } from "../../lib/admin-gallery";
import type { MoveDir } from "../../lib/admin-gallery";
import type { GalleryActionResult } from "../../lib/server/admin-galleries";

export interface ReorderPhoto {
  id: string;
  set: string;
  name: string;
  takenAt: string | null;
}

type Orders = Record<string, string[]>;

const btn =
  "text-micro uppercase border border-ink px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

function groupBySet(photos: ReorderPhoto[]): Orders {
  const out: Orders = {};
  for (const p of photos) (out[p.set] ??= []).push(p.id);
  return out;
}

/**
 * Per-set photo ordering. Mouse: drag a thumb onto another. Keyboard/touch:
 * Enter/Space (or tap) selects a photo, then arrow keys / Home / End or the
 * "Mover antes/después" buttons move it; Escape deselects. Nothing is written
 * until "Guardar orden".
 */
export function PhotoReorder({
  photos,
  version,
  coverPhotoId = null,
  coverAuto = false,
  actionData,
}: {
  photos: ReorderPhoto[];
  version: string;
  /** Effective cover (chosen, else the first photo); gets the "Portada" badge. */
  coverPhotoId?: string | null;
  /** The cover is automatic (no explicit choice): badge says so and offers to pin it. */
  coverAuto?: boolean;
  actionData?: GalleryActionResult;
}) {
  const t = useT();
  const [initial] = useState<Orders>(() => groupBySet(photos));
  const [orders, setOrders] = useState<Orders>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const dragging = useRef<string | null>(null);
  const focusId = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const busy = useNavigation().state !== "idle";

  const byId = new Map(photos.map((p) => [p.id, p]));
  const setOf = (id: string) => byId.get(id)?.set;
  const dirty = JSON.stringify(orders) !== JSON.stringify(initial);

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

  return (
    <div ref={root} className="flex flex-col gap-6">
      <p className="text-small text-grey-600">{t("admin.reorder.help")}</p>
      <p role="status" className="sr-only">
        {announce}
      </p>

      {Object.entries(orders).map(([set, ids]) => {
        const idx = selected ? ids.indexOf(selected) : -1;
        return (
          <fieldset key={set} className="flex flex-col gap-3">
            <legend className="text-micro text-grey-700 mb-2 uppercase">
              {set}
            </legend>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btn}
                disabled={idx <= 0}
                onClick={() => selected && move(selected, "before", false)}
              >
                {t("admin.reorder.before")}
              </button>
              <button
                type="button"
                className={btn}
                disabled={idx === -1 || idx === ids.length - 1}
                onClick={() => selected && move(selected, "after", false)}
              >
                {t("admin.reorder.after")}
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => sortSet(set, "date")}
              >
                {t("admin.reorder.sortDate")}
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => sortSet(set, "name")}
              >
                {t("admin.reorder.sortName")}
              </button>
            </div>
            <ul
              data-set={set}
              className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2"
            >
              {ids.map((id) => {
                const p = byId.get(id)!;
                const isSel = selected === id;
                return (
                  <li
                    key={id}
                    data-photo-id={id}
                    draggable
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
                    className="list-none"
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSel}
                      id={`photo-${id}`}
                      aria-label={p.name}
                      onClick={() => setSelected((s) => (s === id ? null : id))}
                      onKeyDown={(ev) => onKey(ev, id)}
                      className={`relative block cursor-grab outline-offset-2 ${isSel ? "outline-ink outline outline-2" : "focus-visible:outline-ink focus-visible:outline-2"}`}
                    >
                      <img
                        src={`/admin/img/${id}/thumb`}
                        alt={byId.get(id)?.name ?? ""}
                        loading="lazy"
                        draggable={false}
                        className="bg-grey-100 aspect-[3/2] w-full object-cover"
                      />
                      <span className="text-micro bg-paper/90 text-ink absolute bottom-0 left-0 max-w-full truncate px-1">
                        {ids.indexOf(id) + 1}. {p.name}
                      </span>
                    </div>
                    <div className="mt-1 flex min-h-8 flex-wrap items-center gap-1">
                      {coverPhotoId === id ? (
                        <>
                          <span className="text-micro bg-ink text-paper px-2 py-0.5 uppercase">
                            {coverAuto
                              ? t("admin.reorder.coverAuto")
                              : t("admin.reorder.cover")}
                          </span>
                          {coverAuto && (
                            <Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="cover"
                              />
                              <input type="hidden" name="photoId" value={id} />
                              <button
                                type="submit"
                                aria-describedby={`photo-${id}`}
                                disabled={busy}
                                className="text-micro text-grey-700 hover:text-ink focus-visible:outline-ink px-1 py-1 uppercase underline-offset-4 hover:underline focus-visible:outline-2 disabled:opacity-40"
                              >
                                {t("admin.reorder.pinCover")}
                              </button>
                            </Form>
                          )}
                        </>
                      ) : (
                        <Form method="post">
                          <input type="hidden" name="intent" value="cover" />
                          <input type="hidden" name="photoId" value={id} />
                          <button
                            type="submit"
                            aria-describedby={`photo-${id}`}
                            disabled={busy}
                            className="text-micro text-grey-700 hover:text-ink focus-visible:outline-ink px-1 py-1 uppercase underline-offset-4 hover:underline focus-visible:outline-2 disabled:opacity-40"
                          >
                            {t("admin.reorder.useAsCover")}
                          </button>
                        </Form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}

      <Form method="post" className="flex flex-wrap items-center gap-2">
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
    </div>
  );
}
