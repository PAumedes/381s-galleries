import { useId, useLayoutEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";

import { useT } from "../../i18n/use-t";
import type { GalleryActionResult } from "../../lib/server/admin-galleries";
import type { CoverLayout, Palette } from "../../lib/design";
import { ChevronDown, Monitor, Phone } from "../icons";
import { coverSrc, LivePreview, type PreviewDevice } from "./LivePreview";

type Focus = { x: number; y: number };
type Size = { w: number; h: number };

const STEP = 5;
const clamp = (n: number) => Math.min(100, Math.max(0, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

const btn =
  "text-micro uppercase border border-ink min-h-tap px-4 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:min-h-10";
const seg =
  "text-micro flex min-h-tap flex-1 items-center justify-center gap-2 px-3 uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:min-h-9";

export type MobileCover = {
  id: string;
  width: number | null;
  height: number | null;
  focus: Focus | null;
};
export type ChooserPhoto = { id: string; name: string };

/** Keeps a local copy of a server value, replaced when the server's changes. */
function useSynced(value: Focus | null) {
  const [local, setLocal] = useState<Focus | null>(value);
  const [seen, setSeen] = useState(value);
  if (seen?.x !== value?.x || seen?.y !== value?.y) {
    setSeen(value);
    setLocal(value);
  }
  return [local, setLocal] as const;
}

/**
 * "Portada": two connected cards. 1. Elegí el punto focal: the WHOLE photo
 * (uncropped) of the cover being edited (desktop, or the optional mobile one)
 * with a crosshair; a click, tap or arrow keys set the focal point (a point
 * on the image, percent of its width/height), stored only with "Guardar
 * punto focal". 2. Así se ve: the real `CoverHero` at a desktop or phone
 * size. One device switch drives both cards. Without a mobile cover, phones
 * show the desktop cover with its own focal point (the picker then edits it).
 */
export function CoverPreview({
  title,
  eventDate,
  palette,
  coverLayout,
  proofing,
  coverId,
  coverWidth = null,
  coverHeight = null,
  initialFocus,
  actionData,
  mobileCover = null,
  photos = [],
  coverAuto = false,
  device: deviceProp,
  onDevice,
}: {
  title: string;
  eventDate: string | null;
  palette: Palette;
  coverLayout: CoverLayout;
  proofing: boolean;
  /** Effective cover photo (chosen, else the first); null = no photos. */
  coverId: string | null;
  /** Pixel size of the cover photo (aspect for the focal point); null = unknown. */
  coverWidth?: number | null;
  coverHeight?: number | null;
  initialFocus: Focus | null;
  actionData?: GalleryActionResult;
  /** Optional mobile cover (own photo + focal point). */
  mobileCover?: MobileCover | null;
  /** Photos offered by "Cambiar foto". */
  photos?: readonly ChooserPhoto[];
  /** The desktop cover is automatic (first photo). */
  coverAuto?: boolean;
  /** Controlled device (optional; shared with the editor's other previews). */
  device?: PreviewDevice;
  onDevice?: (d: PreviewDevice) => void;
}) {
  const t = useT();
  const busy = useNavigation().state !== "idle";
  const stepId = useId();
  const [ownDevice, setOwnDevice] = useState<PreviewDevice>("desktop");
  const device = deviceProp ?? ownDevice;
  const setDevice = (d: PreviewDevice) => {
    setOwnDevice(d);
    onDevice?.(d);
  };
  const [focus, setFocus] = useSynced(initialFocus);
  const [mobileFocus, setMobileFocus] = useSynced(mobileCover?.focus ?? null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Size | null>(null);
  const [natural, setNatural] = useState<Record<string, Size>>({});

  // Which cover the picker edits: the mobile one only when it exists.
  const editing: "desktop" | "mobile" =
    device === "mobile" && mobileCover ? "mobile" : "desktop";
  const pickId = editing === "mobile" ? mobileCover!.id : coverId;
  const sizeOf = (id: string | null, w: number | null, h: number | null) =>
    w && h ? { w, h } : id ? natural[id] : undefined;
  const deskSize = sizeOf(coverId, coverWidth, coverHeight);
  const mobSize = mobileCover
    ? sizeOf(mobileCover.id, mobileCover.width, mobileCover.height)
    : undefined;
  const aspectOf = (s: Size | undefined) => (s ? s.w / s.h : null);
  const pickAspect = aspectOf(editing === "mobile" ? mobSize : deskSize);
  const cur = editing === "mobile" ? mobileFocus : focus;
  const setCur = editing === "mobile" ? setMobileFocus : setFocus;

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
  let shown: React.CSSProperties = { inset: 0 };
  if (pickAspect && box) {
    const w = Math.min(box.w, box.h * pickAspect);
    const h = w / pickAspect;
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
    setCur({
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
    setCur((c) => ({
      x: round1(clamp((c?.x ?? 50) + d[0]!)),
      y: round1(clamp((c?.y ?? 50) + d[1]!)),
    }));
  }

  const fb =
    actionData?.intent === "focus" || actionData?.intent === "cover"
      ? actionData
      : undefined;
  const fx = cur?.x ?? 50;
  const fy = cur?.y ?? 50;
  const valueText = t("admin.cover.focalValue", { x: fx, y: fy });
  const nameOf = (id: string | null) =>
    photos.find((p) => p.id === id)?.name ?? "";

  const picker = (
    <section
      aria-labelledby={`${stepId}-1`}
      className="border-grey-200 flex min-w-0 flex-col gap-4 border bg-white p-4 md:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${stepId}-1`} className="text-micro text-ink uppercase">
          {t("admin.cover.step1")}
        </h2>
        <p className="text-small text-grey-600">{t("admin.cover.step1Hint")}</p>
      </div>
      <div
        role="group"
        aria-label={t("admin.cover.whichCover")}
        className="border-grey-300 flex border"
      >
        {(["desktop", "mobile"] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={device === d}
            onClick={() => setDevice(d)}
            className={`${seg} ${device === d ? "bg-ink text-paper" : "text-grey-700 hover:text-ink"}`}
          >
            {d === "desktop" ? (
              <Monitor aria-hidden="true" className="size-4" />
            ) : (
              <Phone aria-hidden="true" className="size-4" />
            )}
            {t(
              d === "desktop"
                ? "admin.cover.deviceDesktop"
                : "admin.cover.deviceMobile",
            )}
          </button>
        ))}
      </div>
      {device === "mobile" && !mobileCover && coverId && (
        <p className="text-small text-grey-700 border-grey-300 border-l-2 pl-3">
          {t("admin.cover.mobileFallback")}
        </p>
      )}
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
            onClick={onClick}
            onKeyDown={onKeyDown}
            style={shown}
            className="focus-visible:outline-ink absolute cursor-crosshair touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <img
              src={coverSrc(pickId, false)}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const w = e.currentTarget.naturalWidth;
                const h = e.currentTarget.naturalHeight;
                if (w && h)
                  setNatural((n) =>
                    n[pickId]?.w === w && n[pickId]?.h === h
                      ? n
                      : { ...n, [pickId]: { w, h } },
                  );
              }}
              className="pointer-events-none size-full object-contain select-none"
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
      <p role="status" aria-live="polite" className="text-small text-grey-700">
        {valueText}
        {fb?.ok ? ` · ${fb.message}` : ""}
      </p>
      <Form method="post" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="intent" value="focus" />
        <input type="hidden" name="device" value={editing} />
        <input type="hidden" name="focusX" value={cur ? String(cur.x) : ""} />
        <input type="hidden" name="focusY" value={cur ? String(cur.y) : ""} />
        <button
          type="submit"
          className={`${btn} bg-ink text-paper`}
          disabled={busy || !pickId}
        >
          {t("admin.cover.save")}
        </button>
        <button
          type="button"
          className={btn}
          disabled={!cur}
          onClick={() => setCur(null)}
        >
          {t("admin.cover.center")}
        </button>
      </Form>
      {fb && !fb.ok && (
        <p role="alert" className="border-ink text-small border p-3">
          {fb.error}
        </p>
      )}

      {photos.length > 0 && (
        <div className="border-grey-200 flex flex-col gap-3 border-t pt-4">
          <p className="text-small">
            {editing === "mobile"
              ? t("admin.cover.photoMobile", { name: nameOf(pickId) })
              : coverAuto
                ? t("admin.cover.photoAuto", { name: nameOf(pickId) })
                : t("admin.cover.photo", { name: nameOf(pickId) })}
          </p>
          <div className="flex flex-wrap gap-2">
            {device === "desktop" && !coverAuto && (
              <Form method="post">
                <input type="hidden" name="intent" value="cover" />
                <input type="hidden" name="photoId" value="" />
                <button type="submit" className={btn} disabled={busy}>
                  {t("admin.edit.photos.useFirst")}
                </button>
              </Form>
            )}
            {device === "mobile" && mobileCover && (
              <Form method="post">
                <input type="hidden" name="intent" value="cover" />
                <input type="hidden" name="device" value="mobile" />
                <input type="hidden" name="photoId" value="" />
                <button type="submit" className={btn} disabled={busy}>
                  {t("admin.cover.useDesktop")}
                </button>
              </Form>
            )}
          </div>
          <details
            className="group/choose"
            open={device === "mobile" && !mobileCover ? true : undefined}
          >
            <summary className="text-micro text-ink flex min-h-tap cursor-pointer list-none items-center gap-2 uppercase underline-offset-4 hover:underline md:min-h-8 [&::-webkit-details-marker]:hidden">
              {device === "mobile" && !mobileCover
                ? t("admin.cover.chooseMobile")
                : t("admin.cover.change")}
              <ChevronDown
                aria-hidden="true"
                className="size-4 transition-transform group-open/choose:rotate-180"
              />
            </summary>
            <ul className="mt-3 grid max-h-80 grid-cols-4 gap-1 overflow-y-auto sm:grid-cols-6">
              {photos.map((p) => (
                <li key={p.id} className="list-none">
                  <Form method="post">
                    <input type="hidden" name="intent" value="cover" />
                    {device === "mobile" && (
                      <input type="hidden" name="device" value="mobile" />
                    )}
                    <input type="hidden" name="photoId" value={p.id} />
                    <button
                      type="submit"
                      disabled={busy}
                      aria-label={t("admin.cover.useNamed", { name: p.name })}
                      aria-current={p.id === pickId ? "true" : undefined}
                      className={`bg-grey-100 focus-visible:outline-ink block aspect-square w-full overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 ${p.id === pickId ? "outline-ink outline-2 outline-offset-1" : ""}`}
                    >
                      <img
                        src={`/admin/img/${encodeURIComponent(p.id)}/thumb`}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        className="size-full object-cover"
                      />
                    </button>
                  </Form>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );

  return (
    <div
      data-testid="cover-preview"
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10"
    >
      {picker}
      <div className="border-grey-200 flex min-w-0 flex-col border bg-white p-4 md:p-6 lg:sticky lg:top-6">
        <LivePreview
          heading={t("admin.cover.step2")}
          hint={t("admin.cover.step2Hint")}
          title={title}
          eventDate={eventDate}
          palette={palette}
          coverLayout={coverLayout}
          proofing={proofing}
          cover={
            coverId ? { id: coverId, aspect: aspectOf(deskSize), focus } : null
          }
          mobileCover={
            mobileCover
              ? {
                  id: mobileCover.id,
                  aspect: aspectOf(mobSize),
                  focus: mobileFocus,
                }
              : null
          }
          device={device}
          onDevice={setDevice}
        />
      </div>
    </div>
  );
}
