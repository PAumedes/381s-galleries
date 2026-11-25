import { useLayoutEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  RefObject,
} from "react";
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

type FocalPickerProps = {
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
};

/** The size of the element in `ref`, kept current (null while it has no size); re-measured when `key` changes. */
function useElementSize(ref: RefObject<HTMLElement | null>, key: unknown) {
  const [box, setBox] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
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
  }, [ref, key]);
  return box;
}

/** Where the uncropped image sits, letterboxed (object-fit: contain) inside the box. */
function letterbox(box: Size | null, aspect: number | null): CSSProperties {
  if (!aspect || !box) return { inset: 0 };
  const w = Math.min(box.w, box.h * aspect);
  const h = w / aspect;
  return { left: (box.w - w) / 2, top: (box.h - h) / 2, width: w, height: h };
}

/** The arrow key's move of the focal point, in percent; null for any other key. */
function arrowDelta(key: string): [number, number] | null {
  switch (key) {
    case "ArrowLeft":
      return [-STEP, 0];
    case "ArrowRight":
      return [STEP, 0];
    case "ArrowUp":
      return [0, -STEP];
    case "ArrowDown":
      return [0, STEP];
    default:
      return null;
  }
}

/** Touch drag of the point; on release the new point is saved (a `focus` action for the device being edited). */
function useSavedFocalDrag(
  cur: Focus | null,
  setCur: FocalPickerProps["setCur"],
  editing: "desktop" | "mobile",
) {
  const submit = useSubmit();
  return useFocalDrag({
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
}

/** A click sets the point under the pointer. */
const clickHandler =
  (setCur: FocalPickerProps["setCur"]) => (ev: MouseEvent) => {
    const f = focusAt(
      ev.currentTarget.getBoundingClientRect(),
      ev.clientX,
      ev.clientY,
    );
    if (f) setCur(f);
  };

/** Arrow keys nudge the point by STEP percent (from the centre when unset). */
const arrowKeyHandler =
  (setCur: FocalPickerProps["setCur"]) => (ev: KeyboardEvent) => {
    const d = arrowDelta(ev.key);
    if (!d) return;
    ev.preventDefault();
    setCur((c) => ({
      x: round1(clamp((c?.x ?? 50) + d[0])),
      y: round1(clamp((c?.y ?? 50) + d[1])),
    }));
  };

/** Crosshair: thin lines through the point + a ring on it. */
function Crosshair({ fx, fy }: { fx: number; fy: number }) {
  return (
    <>
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
    </>
  );
}

/**
 * Step 1 of the cover editor: the whole (uncropped) cover photo letterboxed
 * in a box; click, touch-drag or arrow keys move the focal point.
 */
export function FocalPicker(props: FocalPickerProps) {
  const { pickId, aspect, cur, setCur, editing, versions } = props;
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const shown = letterbox(useElementSize(boxRef, pickId), aspect);

  const onClick = clickHandler(setCur);
  const {
    ref: dragRef,
    dragging,
    handlers: dragHandlers,
  } = useSavedFocalDrag(cur, setCur, editing);
  const onKeyDown = arrowKeyHandler(setCur);

  if (!pickId)
    return (
      <p className="text-small text-grey-600">{t("admin.cover.noPhotos")}</p>
    );
  return (
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
        aria-valuetext={props.valueText}
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
            if (w && h) props.onNatural(pickId, { w, h });
          }}
          className="pointer-events-none absolute inset-0 size-full object-contain select-none"
        />
        <Crosshair fx={props.fx} fy={props.fy} />
      </div>
    </div>
  );
}
