import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { useSubmit } from "react-router";

import { useT } from "../../i18n/use-t";
import { FadeImg } from "../FadeImg";
import { adminImgSrc, type Versions } from "../img-url";
import { coverSrc } from "./LivePreview";
import {
  clamp,
  focusAt,
  round1,
  useFocalDrag,
  type Focus,
} from "./use-focal-drag";

type Size = { w: number; h: number };

const STEP = 5;

/**
 * Step 1 of the cover editor: the whole (uncropped) cover photo letterboxed
 * in a box; click, touch-drag or arrow keys move the focal point.
 */
export function FocalPicker({
  pickId,
  aspect,
  cur,
  setCur,
  editing,
  versions,
  valueText,
  fx,
  fy,
  onNatural,
}: {
  pickId: string | null;
  /** Width / height of the photo, null = unknown yet. */
  aspect: number | null;
  cur: Focus | null;
  setCur: (f: Focus | null | ((c: Focus | null) => Focus | null)) => void;
  editing: "desktop" | "mobile";
  versions?: Versions;
  valueText: string;
  fx: number;
  fy: number;
  /** The browser learned the photo's natural size. */
  onNatural: (id: string, size: Size) => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setBox((b) =>
        w > 0 && h > 0 ? (b && b.w === w && b.h === h ? b : { w, h }) : null,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pickId]);

  // The uncropped image, letterboxed (object-fit: contain) inside the box.
  let shown: CSSProperties = { inset: 0 };
  if (aspect && box) {
    const w = Math.min(box.w, box.h * aspect);
    const h = w / aspect;
    shown = {
      left: (box.w - w) / 2,
      top: (box.h - h) / 2,
      width: w,
      height: h,
    };
  }

  function onClick(ev: MouseEvent) {
    const f = focusAt(
      ev.currentTarget.getBoundingClientRect(),
      ev.clientX,
      ev.clientY,
    );
    if (f) setCur(f);
  }
  // Touch: drag the point, save on release.
  const submit = useSubmit();
  const {
    ref: dragRef,
    dragging,
    handlers: dragHandlers,
  } = useFocalDrag({
    point: cur,
    onPoint: setCur,
    onCommit: (f) =>
      submit(
        {
          intent: "focus",
          device: editing,
          focusX: String(f.x),
          focusY: String(f.y),
        },
        { method: "post" },
      ),
  });
  function onKeyDown(ev: KeyboardEvent) {
    const d =
      ev.key === "ArrowLeft"
        ? [-STEP, 0]
        : ev.key === "ArrowRight"
          ? [STEP, 0]
          : ev.key === "ArrowUp"
            ? [0, -STEP]
            : ev.key === "ArrowDown"
              ? [0, STEP]
              : null;
    if (!d) return;
    ev.preventDefault();
    setCur((c) => ({
      x: round1(clamp((c?.x ?? 50) + d[0]!)),
      y: round1(clamp((c?.y ?? 50) + d[1]!)),
    }));
  }

  return (
    <>
      {pickId ? (
        <div
          ref={boxRef}
          data-testid="focus-box"
          className="bg-grey-100 relative h-72 w-full md:h-80"
        >
          <div
            role="application"
            tabIndex={0}
            data-testid="focus-picker"
            aria-label={t("admin.cover.pickerLabel")}
            aria-valuetext={valueText}
            ref={dragRef}
            onClick={onClick}
            onKeyDown={onKeyDown}
            {...dragHandlers}
            style={dragging ? { ...shown, touchAction: "none" } : shown}
            className="focus-visible:outline-ink absolute cursor-crosshair touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <FadeImg
              src={coverSrc(pickId, false, versions?.[pickId])}
              placeholder={adminImgSrc(pickId, "thumb", versions?.[pickId])}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const w = e.currentTarget.naturalWidth;
                const h = e.currentTarget.naturalHeight;
                if (w && h) onNatural(pickId, { w, h });
              }}
              className="pointer-events-none absolute inset-0 size-full object-contain select-none"
            />
            {/* Crosshair: thin lines through the point + a ring on it. */}
            <span
              aria-hidden="true"
              style={{ left: `${fx}%` }}
              className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-white/70 mix-blend-difference"
            />
            <span
              aria-hidden="true"
              style={{ top: `${fy}%` }}
              className="pointer-events-none absolute inset-x-0 h-px -translate-y-1/2 bg-white/70 mix-blend-difference"
            />
            <span
              data-testid="focus-marker"
              aria-hidden="true"
              style={{ left: `${fx}%`, top: `${fy}%` }}
              className="pointer-events-none absolute size-6 -translate-1/2 rounded-full border-2 border-white bg-black/30 shadow"
            />
          </div>
        </div>
      ) : (
        <p className="text-small text-grey-600">{t("admin.cover.noPhotos")}</p>
      )}
    </>
  );
}
