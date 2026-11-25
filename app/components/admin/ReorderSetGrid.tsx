import { useT } from "../../i18n/use-t";
import { GRID_BY_SIZE, type FitPrefs } from "./photo-fit";
import type { useQuickLook } from "./QuickLook";
import { SetToolbar } from "./ReorderBars";
import { ReorderTile, type TileDnd } from "./ReorderTile";
import type { usePhotoOrder } from "./use-photo-order";

/** Which tiles wear the cover badges. */
export interface CoverMarks {
  coverId: string | null;
  mobileId: string | null;
  /** The cover is automatic: the badge's label says so. */
  auto: boolean;
}

/** One set of the "Fotos" tab: toolbar (sort, move) and its grid of tiles. */
export function ReorderSetGrid({
  set,
  ids,
  order,
  dndFor,
  prefs,
  busy,
  quick,
  cover,
  onView,
}: {
  set: string;
  ids: string[];
  order: ReturnType<typeof usePhotoOrder>;
  dndFor: (id: string, set: string, ids: string[]) => TileDnd;
  prefs: FitPrefs;
  busy: boolean;
  quick: ReturnType<typeof useQuickLook>;
  cover: CoverMarks;
  onView: (id: string) => void;
}) {
  const t = useT();
  const { selected, byId } = order;
  const idx = selected ? ids.indexOf(selected) : -1;
  const coverLabel = cover.auto
    ? t("admin.reorder.coverAutoBadge")
    : t("admin.reorder.cover");
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="sr-only">{set}</legend>
      <SetToolbar
        set={set}
        count={ids.length}
        canBefore={idx > 0}
        canAfter={idx !== -1 && idx !== ids.length - 1}
        onBefore={() => selected && order.move(selected, "before", false)}
        onAfter={() => selected && order.move(selected, "after", false)}
        onSort={(mode) => order.sortSet(set, mode)}
      />
      <ul data-set={set} className={`grid gap-1.5 ${GRID_BY_SIZE[prefs.size]}`}>
        {ids.map((id, i) => (
          <ReorderTile
            key={id}
            id={id}
            index={i}
            photo={byId.get(id)!}
            selected={selected === id}
            isCover={cover.coverId === id}
            isMobile={cover.mobileId === id}
            coverLabel={coverLabel}
            coverAuto={cover.auto}
            prefs={prefs}
            busy={busy}
            quick={quick}
            dnd={dndFor(id, set, ids)}
            onToggle={() => order.setSelected((s) => (s === id ? null : id))}
            onKey={(ev) => order.onKey(ev, id)}
            onView={() => onView(id)}
          />
        ))}
      </ul>
    </fieldset>
  );
}
