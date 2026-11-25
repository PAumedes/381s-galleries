import { useRef } from "react";

import { moveTo } from "../../lib/admin-gallery";
import type { TileDnd } from "./ReorderTile";

/**
 * Mouse drag-and-drop between the tiles of one set: `dndFor` builds the
 * handlers of the tile `id` in `set` (ordered `ids`). Dropping on another
 * set's tile is ignored.
 */
export function useReorderDnd(
  setOf: (id: string) => string | undefined,
  apply: (set: string, ids: string[], moved: string) => void,
) {
  const dragging = useRef<string | null>(null);
  return function dndFor(id: string, set: string, ids: string[]): TileDnd {
    return {
      onDragStart: (ev) => {
        dragging.current = id;
        ev.dataTransfer?.setData?.("text/plain", id);
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (ev) => {
        const d = dragging.current;
        if (d && d !== id && setOf(d) === set) {
          ev.preventDefault();
          if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
        }
      },
      onDrop: (ev) => {
        const d = dragging.current;
        dragging.current = null;
        if (!d || d === id || setOf(d) !== set) return;
        ev.preventDefault();
        apply(set, moveTo(ids, ids.indexOf(d), ids.indexOf(id)), d);
      },
      onDragEnd: () => {
        dragging.current = null;
      },
    };
  };
}
