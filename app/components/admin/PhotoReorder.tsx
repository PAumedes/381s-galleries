import { useLayoutEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";

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
  actionData,
}: {
  photos: ReorderPhoto[];
  version: string;
  actionData?: GalleryActionResult;
}) {
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
        `${byId.get(moved)?.name ?? ""} movida a la posición ${ids.indexOf(moved) + 1} de ${ids.length}.`,
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
      `Fotos de ${set} ordenadas por ${mode === "date" ? "fecha de captura" : "nombre"}.`,
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
      <p className="text-small text-grey-600">
        Arrastrá las miniaturas, o elegí una (clic, Enter o Espacio) y movela
        con las flechas, Inicio/Fin o los botones “Mover antes/después”. Escape
        quita la selección. Los cambios se aplican al guardar.
      </p>
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
                Mover antes
              </button>
              <button
                type="button"
                className={btn}
                disabled={idx === -1 || idx === ids.length - 1}
                onClick={() => selected && move(selected, "after", false)}
              >
                Mover después
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => sortSet(set, "date")}
              >
                Ordenar por fecha de captura
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => sortSet(set, "name")}
              >
                Ordenar por nombre
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
          Guardar orden
        </button>
        <button
          type="button"
          className={btn}
          disabled={!dirty}
          onClick={() => {
            setOrders(initial);
            setSelected(null);
            setAnnounce("Orden restablecido.");
          }}
        >
          Restablecer
        </button>
      </Form>
      {feedback && !feedback.ok && (
        <p role="alert" className="border-ink border p-3 text-small">
          {feedback.error}{" "}
          {feedback.stale && (
            <a href="?" className="underline">
              Recargar
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
