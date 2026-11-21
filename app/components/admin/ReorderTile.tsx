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

/** One draggable, keyboard-movable photo tile of the reorder grid. */
export function ReorderTile({
  id,
  index,
  photo,
  selected,
  isCover,
  isMobile,
  coverLabel,
  coverAuto,
  prefs,
  busy,
  quick,
  dnd,
  onToggle,
  onKey,
  onView,
}: {
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
}) {
  return (
    <li
      data-photo-id={id}
      draggable
      onPointerDownCapture={quick.pointerDown}
      onPointerLeave={quick.stop}
      onFocus={(ev) => quick.focus(id, ev.currentTarget)}
      onBlur={quick.stop}
      {...dnd}
      className="group @container flex min-w-0 list-none flex-col gap-1"
    >
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
          onClick={onToggle}
          onKeyDown={onKey}
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
          {index + 1}
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
        {photo.name}
      </span>
      <div onPointerEnter={quick.stop} onFocus={(ev) => ev.stopPropagation()}>
        <TileActions
          id={id}
          isCover={isCover}
          coverAuto={coverAuto}
          isMobile={isMobile}
          busy={busy}
          onView={onView}
        />
      </div>
    </li>
  );
}
