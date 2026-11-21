import { useId, useState } from "react";
import { Form, useNavigation } from "react-router";

import { useT } from "../../i18n/use-t";
import type { GalleryActionResult } from "../../lib/server/admin-galleries";
import type { CoverLayout, Palette } from "../../lib/design";
import { Monitor, Phone } from "../icons";
import type { Versions } from "../img-url";
import { LivePreview, type PreviewDevice } from "./LivePreview";
import { btn } from "./gallery-edit/ui";
import { CoverChooser } from "./CoverChooser";
import { FocalPicker } from "./FocalPicker";
import type { Focus } from "./use-focal-drag";

type Size = { w: number; h: number };

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
  mobileNoWm = false,
  photos = [],
  coverAuto = false,
  versions,
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
  /** Prueba: the chosen mobile cover has no preview-wm (desktop one is used). */
  mobileNoWm?: boolean;
  /** Photos offered by "Cambiar foto". */
  photos?: readonly ChooserPhoto[];
  /** The desktop cover is automatic (first photo). */
  coverAuto?: boolean;
  /** Admin image tokens by photo id (`?v=`). */
  versions?: Versions;
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

  const fb =
    actionData?.intent === "focus" || actionData?.intent === "cover"
      ? actionData
      : undefined;
  const fx = cur?.x ?? 50;
  const fy = cur?.y ?? 50;
  const valueText = t("admin.cover.focalValue", { x: fx, y: fy });

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
      {mobileNoWm && (
        <p
          role="alert"
          className="text-small text-ink border-ink border-l-2 pl-3"
        >
          {t("admin.cover.mobileNoWm")}
        </p>
      )}
      {device === "mobile" && !mobileCover && coverId && (
        <p className="text-small text-grey-700 border-grey-300 border-l-2 pl-3">
          {t("admin.cover.mobileFallback")}
        </p>
      )}
      <FocalPicker
        pickId={pickId}
        aspect={pickAspect}
        cur={cur}
        setCur={setCur}
        editing={editing}
        versions={versions}
        valueText={valueText}
        fx={fx}
        fy={fy}
        onNatural={(id, size) =>
          setNatural((n) =>
            n[id]?.w === size.w && n[id]?.h === size.h
              ? n
              : { ...n, [id]: size },
          )
        }
      />
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

      <CoverChooser
        photos={photos}
        editing={editing}
        device={device}
        coverAuto={coverAuto}
        hasMobileCover={!!mobileCover}
        pickId={pickId}
        versions={versions}
        busy={busy}
      />
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
          versions={versions}
          device={device}
          onDevice={setDevice}
        />
      </div>
    </div>
  );
}
