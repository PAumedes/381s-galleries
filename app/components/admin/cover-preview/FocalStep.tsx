import { useId } from "react";
import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import { Monitor, Phone } from "../../icons";
import type { Versions } from "../../img-url";
import { btn } from "../gallery-edit/ui";
import { CoverChooser } from "../CoverChooser";
import { FocalPicker } from "../FocalPicker";
import type { PreviewDevice } from "../LivePreview";
import type { ChooserPhoto } from "./types";
import type { useCoverEditor } from "./use-cover-editor";

const seg =
  "text-micro flex min-h-tap flex-1 items-center justify-center gap-2 px-3 uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:min-h-9";

/** Desktop / phone switch: which cover the picker (and the preview) shows. */
function DeviceSwitch({
  device,
  onDevice,
}: {
  device: PreviewDevice;
  onDevice: (d: PreviewDevice) => void;
}) {
  const t = useT();
  return (
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
          onClick={() => onDevice(d)}
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
  );
}

type FocalStepProps = {
  editor: ReturnType<typeof useCoverEditor>;
  coverId: string | null;
  hasMobileCover: boolean;
  mobileNoWm: boolean;
  photos: readonly ChooserPhoto[];
  coverAuto: boolean;
  versions?: Versions;
  busy: boolean;
  feedback?: GalleryActionResult;
};

/** Step 1: choose the focal point of the cover being edited, save it, change the photo. */
export function FocalStep({
  editor,
  coverId,
  hasMobileCover,
  mobileNoWm,
  photos,
  coverAuto,
  versions,
  busy,
  feedback,
}: FocalStepProps) {
  const t = useT();
  const stepId = useId();
  const { device, editing, pickId, cur, setCur } = editor;
  const fx = cur?.x ?? 50;
  const fy = cur?.y ?? 50;
  const valueText = t("admin.cover.focalValue", { x: fx, y: fy });
  return (
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
      <DeviceSwitch device={device} onDevice={editor.setDevice} />
      {mobileNoWm && (
        <p
          role="alert"
          className="text-small text-ink border-ink border-l-2 pl-3"
        >
          {t("admin.cover.mobileNoWm")}
        </p>
      )}
      {device === "mobile" && !hasMobileCover && coverId && (
        <p className="text-small text-grey-700 border-grey-300 border-l-2 pl-3">
          {t("admin.cover.mobileFallback")}
        </p>
      )}
      <FocalPicker
        pickId={pickId}
        aspect={editor.pickAspect}
        cur={cur}
        setCur={setCur}
        editing={editing}
        versions={versions}
        valueText={valueText}
        fx={fx}
        fy={fy}
        onNatural={editor.onNatural}
      />
      <p role="status" aria-live="polite" className="text-small text-grey-700">
        {valueText}
        {feedback?.ok ? ` · ${feedback.message}` : ""}
      </p>
      <FocalSaveForm editor={editor} busy={busy} />
      {feedback && !feedback.ok && (
        <p role="alert" className="border-ink text-small border p-3">
          {feedback.error}
        </p>
      )}

      <CoverChooser
        photos={photos}
        editing={editing}
        device={device}
        coverAuto={coverAuto}
        hasMobileCover={hasMobileCover}
        pickId={pickId}
        versions={versions}
        busy={busy}
      />
    </section>
  );
}

/** Posts the unsaved focal point of the cover being edited. */
function FocalSaveForm({
  editor,
  busy,
}: {
  editor: ReturnType<typeof useCoverEditor>;
  busy: boolean;
}) {
  const t = useT();
  const { editing, pickId, cur, setCur } = editor;
  return (
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
  );
}
