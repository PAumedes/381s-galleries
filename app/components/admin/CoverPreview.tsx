import { useLayoutEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";

import { useLang } from "../../i18n/use-t";
import { formatEventDate } from "../../lib/event-date";
import { useStudioName } from "../../lib/use-studio-name";
import type { GalleryActionResult } from "../../lib/server/admin-galleries";
import { CoverHero } from "../CoverHero";

type Focus = { x: number; y: number };
type Size = { w: number; h: number };

const STEP = 5;
/** Virtual viewports the real cover is laid out in, then scaled down. */
const FRAMES = {
  desktop: { w: 1280, h: 720, ratio: "16 / 9", label: "Escritorio" },
  mobile: { w: 390, h: 823, ratio: "9 / 19", label: "Móvil" },
} as const;

const clamp = (n: number) => Math.min(100, Math.max(0, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

const btn =
  "text-micro uppercase border border-ink px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/**
 * Cover editor: a picker showing the WHOLE photo (uncropped) where a click, tap
 * or arrow keys set the focal point (a point on the image, in percent of its
 * width/height), beside a live, scaled-down render of the client cover (the
 * same `CoverHero` the public gallery uses) in desktop/mobile frames. The
 * point is only stored when "Guardar punto focal" is pressed.
 */
export function CoverPreview({
  title,
  eventDate,
  theme,
  proofing,
  coverId,
  coverWidth = null,
  coverHeight = null,
  initialFocus,
  actionData,
}: {
  title: string;
  eventDate: string | null;
  theme: "light" | "dark";
  proofing: boolean;
  /** Effective cover photo (chosen, else the first); null = no photos. */
  coverId: string | null;
  /** Pixel size of the cover photo (aspect for the focal point); null = unknown. */
  coverWidth?: number | null;
  coverHeight?: number | null;
  initialFocus: Focus | null;
  actionData?: GalleryActionResult;
}) {
  const studio = useStudioName();
  // TODO(admin i18n): the admin has no language switch yet; this reads the same
  // source the ES/EN admin will use (root loader lang, default "es").
  const lang = useLang();
  const busy = useNavigation().state !== "idle";
  const [view, setView] = useState<keyof typeof FRAMES>("desktop");
  const [focus, setFocus] = useState<Focus | null>(initialFocus);
  const [seen, setSeen] = useState(initialFocus);
  // A saved/reset focus coming back from the server replaces the local one.
  if (seen?.x !== initialFocus?.x || seen?.y !== initialFocus?.y) {
    setSeen(initialFocus);
    setFocus(initialFocus);
  }
  const frameRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [box, setBox] = useState<Size | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const f = FRAMES[view];

  const imgW = coverWidth && coverHeight ? coverWidth : natural?.w;
  const imgH = coverWidth && coverHeight ? coverHeight : natural?.h;
  const aspect = imgW && imgH ? imgW / imgH : null;

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setScale(el.clientWidth / f.w);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [f.w]);

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
  }, [coverId]);

  // The uncropped image, letterboxed (object-fit: contain) inside the box.
  let shown: React.CSSProperties = { inset: 0 };
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

  function onClick(ev: React.MouseEvent) {
    const r = ev.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return;
    setFocus({
      x: round1(clamp(((ev.clientX - r.left) / r.width) * 100)),
      y: round1(clamp(((ev.clientY - r.top) / r.height) * 100)),
    });
  }
  function onKeyDown(ev: React.KeyboardEvent) {
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
    setFocus((cur) => ({
      x: round1(clamp((cur?.x ?? 50) + d[0]!)),
      y: round1(clamp((cur?.y ?? 50) + d[1]!)),
    }));
  }

  const fb = actionData?.intent === "focus" ? actionData : undefined;
  const src = coverId
    ? `/admin/img/${encodeURIComponent(coverId)}/${proofing ? "view-sm-wm" : "view-sm"}`
    : null;
  const fx = focus?.x ?? 50;
  const fy = focus?.y ?? 50;
  const valueText = `Punto focal: ${fx}% horizontal, ${fy}% vertical`;

  return (
    <div data-testid="cover-preview" className="flex flex-col gap-3">
      {src && (
        <div
          ref={boxRef}
          data-testid="focus-box"
          className="bg-grey-100 relative h-64 w-full"
        >
          <div
            role="application"
            tabIndex={0}
            data-testid="focus-picker"
            aria-label="Punto focal de la portada: hacé clic en la foto o usá las flechas"
            aria-valuetext={valueText}
            onClick={onClick}
            onKeyDown={onKeyDown}
            style={shown}
            className="absolute cursor-crosshair focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <img
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) =>
                setNatural({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
              className="pointer-events-none size-full object-contain select-none"
            />
            <span
              data-testid="focus-marker"
              aria-hidden="true"
              style={{ left: `${fx}%`, top: `${fy}%` }}
              className="pointer-events-none absolute size-4 -translate-1/2 rounded-full border-2 border-white bg-black/40 shadow"
            />
          </div>
        </div>
      )}
      <p role="status" aria-live="polite" className="text-small text-grey-700">
        {valueText}
        {fb?.ok ? ` · ${fb.message}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(FRAMES) as (keyof typeof FRAMES)[]).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={view === k}
            onClick={() => setView(k)}
            className={`${btn} ${view === k ? "bg-ink text-paper" : ""}`}
          >
            {FRAMES[k].label}
          </button>
        ))}
      </div>
      <div
        ref={frameRef}
        data-frame={view}
        style={{ aspectRatio: f.ratio }}
        className={`border-grey-300 relative w-full overflow-hidden border ${view === "mobile" ? "max-w-[13rem]" : ""}`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 origin-top-left select-none"
          style={{
            width: f.w,
            height: f.h,
            transform: `scale(${scale})`,
          }}
        >
          <CoverHero
            embedded
            title={title}
            date={formatEventDate(eventDate, lang)}
            studio={studio}
            src={src}
            proofing={false}
            focus={focus}
            aspect={aspect}
            scrollLabel="Ver galería"
          />
        </div>
      </div>
      <div
        data-theme={theme === "dark" ? "dark" : undefined}
        className="bg-paper text-ink text-micro border-grey-300 flex items-center justify-between border px-3 py-2 uppercase"
      >
        <span>Tema {theme === "dark" ? "oscuro" : "claro"}</span>
        <span>
          {proofing ? "Prueba: con marca de agua" : "Entrega: sin marca"}
        </span>
      </div>
      <p className="text-small text-grey-600">
        {coverId
          ? "Así se ve la portada. Hacé clic en la foto (o usá las flechas con el selector enfocado) para marcar lo que no debe quedar fuera del recorte."
          : "Todavía no hay fotos para la portada."}
      </p>
      <Form method="post" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="intent" value="focus" />
        <input
          type="hidden"
          name="focusX"
          value={focus ? String(focus.x) : ""}
        />
        <input
          type="hidden"
          name="focusY"
          value={focus ? String(focus.y) : ""}
        />
        <button
          type="submit"
          className={`${btn} bg-ink text-paper`}
          disabled={busy || !coverId}
        >
          Guardar punto focal
        </button>
        <button
          type="button"
          className={btn}
          disabled={!focus}
          onClick={() => setFocus(null)}
        >
          Centrar
        </button>
      </Form>
      {fb && !fb.ok && (
        <p role="alert" className="border-ink border p-3 text-small">
          {fb.error}
        </p>
      )}
      {fb?.ok && <p className="text-small text-grey-700">{fb.message}</p>}
    </div>
  );
}
