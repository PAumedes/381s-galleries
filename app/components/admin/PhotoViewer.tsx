import { useEffect, useRef } from "react";

import { useT } from "../../i18n/use-t";
import { ChevronLeft, ChevronRight, Close } from "../icons";

const BTN =
  "flex size-11 items-center justify-center text-white/80 hover:text-white disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-white";

/**
 * "Ver completa": the whole photo (uncropped, 1200 px admin view) over a dark
 * backdrop. Arrows / buttons walk the grid order; Escape or the close button
 * return focus to where it was.
 */
export function PhotoViewer({
  ids,
  names,
  current,
  onChange,
  onClose,
}: {
  ids: readonly string[];
  names: ReadonlyMap<string, { name: string }>;
  current: string;
  onChange: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  const i = ids.indexOf(current);
  const prev = i > 0 ? ids[i - 1] : undefined;
  const next = i >= 0 && i < ids.length - 1 ? ids[i + 1] : undefined;
  const name = names.get(current)?.name ?? "";

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => back?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && prev) onChange(prev);
      else if (e.key === "ArrowRight" && next) onChange(next);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prev, next, onChange, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex items-center justify-between gap-4 py-1 pr-1 pl-4">
        <p className="text-micro truncate uppercase">
          {name}
          <span className="text-white/60">
            {" "}
            · {i + 1} / {ids.length}
          </span>
        </p>
        <button
          ref={closeRef}
          type="button"
          aria-label={t("admin.viewer.close")}
          onClick={onClose}
          className={BTN}
        >
          <Close aria-hidden="true" className="size-5" />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-12 pb-6">
        <img
          key={current}
          src={`/admin/img/${encodeURIComponent(current)}/view-sm`}
          alt={name}
          draggable={false}
          className="max-h-full max-w-full object-contain select-none"
        />
        <button
          type="button"
          aria-label={t("admin.viewer.prev")}
          disabled={!prev}
          onClick={() => prev && onChange(prev)}
          className={`${BTN} absolute top-1/2 left-0 -translate-y-1/2`}
        >
          <ChevronLeft aria-hidden="true" className="size-6" />
        </button>
        <button
          type="button"
          aria-label={t("admin.viewer.next")}
          disabled={!next}
          onClick={() => next && onChange(next)}
          className={`${BTN} absolute top-1/2 right-0 -translate-y-1/2`}
        >
          <ChevronRight aria-hidden="true" className="size-6" />
        </button>
      </div>
    </div>
  );
}
