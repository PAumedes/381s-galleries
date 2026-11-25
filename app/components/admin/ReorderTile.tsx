import type { DragEventHandler, KeyboardEventHandler } from "react";

import { adminImgSrc } from "../img-url";
import { FRAME_BY_MODE, IMG_BY_MODE, type FitPrefs } from "./photo-fit";
import { useQuickLook } from "./QuickLook";
import { TileActions, TileBadges } from "./TileActions";
import type { ReorderPhoto } from "./PhotoReorder";

/** Mouse drag-and-drop handlers of one tile (bound by the grid). */
export interface TileDnd {
  onDragStart: DragEventHandler<HTMLLIElement>;
  onDragOver: DragEventHandler<HTMLLIElement>;
  onDrop: DragEventHandler<HTMLLIElement>;
  onDragEnd: DragEventHandler<HTMLLIElement>;
}

interface ReorderTileProps {
  id: string;
  index: number;
  photo: ReorderPhoto;
  selected: boolean;
  isCover: boolean;
  isMobile: boolean;
  coverLabel: string;
  coverAuto: boolean;
  prefs: FitPrefs;
  busy: boolean;
  quick: ReturnType<typeof useQuickLook>;
  dnd: TileDnd;
  onToggle: () => void;
  onKey: KeyboardEventHandler<HTMLDivElement>;
  onView: () => void;
}

/** The picture with its position number and cover badges: click / Enter selects it. */
function TileFrame({ p }: { p: ReorderTileProps }) {
  const { id, photo, selected, prefs, quick } = p;
  return (
    <div
      data-thumb-frame=""
      onPointerEnter={(ev) =>
        quick.hover(id, ev.currentTarget.parentElement!, ev.pointerType)
      }
      className={`bg-grey-100 relative ${FRAME_BY_MODE[prefs.mode]} overflow-hidden ${selected ? "outline-ink outline-2 outline-offset-2" : ""}`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        id={`photo-${id}`}
        aria-label={photo.name}
        onClick={p.onToggle}
        onKeyDown={p.onKey}
        className="focus-visible:outline-ink absolute inset-0 cursor-grab outline-offset-2 focus-visible:outline-2"
      >
        <img
          src={adminImgSrc(id, "thumb", photo.v)}
          alt={photo.name}
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
        {p.index + 1}
      </span>
      <TileBadges
        isCover={p.isCover}
        isMobile={p.isMobile}
        coverLabel={p.coverLabel}
      />
    </div>
  );
}

/** One draggable, keyboard-movable photo tile of the reorder grid. */
export function ReorderTile(p: ReorderTileProps) {
  const { id, quick } = p;
  return (
    <li
      data-photo-id={id}
      draggable
      onPointerDownCapture={quick.pointerDown}
      onPointerLeave={quick.stop}
      onFocus={(ev) => quick.focus(id, ev.currentTarget)}
      onBlur={quick.stop}
      {...p.dnd}
      className="group @container flex min-w-0 list-none flex-col gap-1"
    >
      <TileFrame p={p} />
      <span
        aria-hidden="true"
        className="text-grey-600 truncate text-[0.6875rem]"
      >
        {p.photo.name}
      </span>
      <div onPointerEnter={quick.stop} onFocus={(ev) => ev.stopPropagation()}>
        <TileActions
          id={id}
          isCover={p.isCover}
          coverAuto={p.coverAuto}
          isMobile={p.isMobile}
          busy={p.busy}
          onView={p.onView}
        />
      </div>
    </li>
  );
}
