import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

import type { TFunction } from "../../i18n/t";
import { movePhoto, sortPhotos } from "../../lib/admin-gallery";
import type { MoveDir } from "../../lib/admin-gallery";
import type { ReorderPhoto } from "./PhotoReorder";

export type Orders = Record<string, string[]>;

export function groupBySet(photos: ReorderPhoto[]): Orders {
  const out: Orders = {};
  for (const p of photos) (out[p.set] ??= []).push(p.id);
  return out;
}

/** Arrow / Home / End key to the move it asks for (null = not a move key). */
export function keyToMove(key: string): MoveDir | null {
  if (key === "ArrowRight" || key === "ArrowDown") return "after";
  if (key === "ArrowLeft" || key === "ArrowUp") return "before";
  if (key === "Home") return "start";
  if (key === "End") return "end";
  return null;
}

/**
 * Ref holding the id of the tile to focus after the next render (a moved
 * tile is a new DOM position: keyboard users keep their place).
 */
function useFocusAfterMove(root: RefObject<HTMLElement | null>) {
  const focusRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!focusRef.current) return;
    const id = focusRef.current;
    focusRef.current = null;
    Array.from(
      root.current?.querySelectorAll<HTMLElement>("[data-photo-id]") ?? [],
    )
      .find((li) => li.dataset.photoId === id)
      ?.querySelector<HTMLElement>("[role=button]")
      ?.focus();
  });
  return focusRef;
}

/** Enter/Space toggles the selection, Escape clears it, arrows move the selected tile. */
function handleKey(
  ev: KeyboardEvent,
  id: string,
  selected: string | null,
  setSelected: (f: (s: string | null) => string | null) => void,
  move: (id: string, dir: MoveDir) => void,
) {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    setSelected((s) => (s === id ? null : id));
  } else if (ev.key === "Escape") {
    setSelected(() => null);
  } else if (selected === id) {
    const dir = keyToMove(ev.key);
    if (dir) {
      ev.preventDefault();
      move(id, dir);
    }
  }
}

/**
 * Order state of the "Fotos" grids: per-set orders, the selected photo, the
 * live-region message, keyboard handling and the focus that follows a moved
 * tile. `root` is the element holding the tiles.
 */
export function usePhotoOrder(
  photos: ReorderPhoto[],
  t: TFunction,
  root: RefObject<HTMLElement | null>,
) {
  const [initial] = useState<Orders>(() => groupBySet(photos));
  const [orders, setOrders] = useState<Orders>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const byId = new Map(photos.map((p) => [p.id, p]));

  const focusRef = useFocusAfterMove(root);

  function apply(set: string, ids: string[], moved?: string, refocus = true) {
    setOrders((o) => ({ ...o, [set]: ids }));
    if (moved) {
      if (refocus) focusRef.current = moved;
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
    const set = byId.get(id)?.set;
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
  function reset() {
    setOrders(initial);
    setSelected(null);
    setAnnounce(t("admin.reorder.wasReset"));
  }

  return {
    orders,
    dirty: JSON.stringify(orders) !== JSON.stringify(initial),
    selected,
    setSelected,
    announce,
    byId,
    apply,
    move,
    sortSet,
    onKey: (ev: KeyboardEvent, id: string) =>
      handleKey(ev, id, selected, setSelected, move),
    reset,
  };
}
