import type { GalleryMode } from "../../../lib/constants";
import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import type { EditGallery, FieldErrors, GalleryEditData } from "./types";
import { btnPrimary, Check, Feedback, Section } from "./ui";

/** The download-size checkboxes (off in proofing, which serves watermarked previews only). */
const DOWNLOAD_OPTIONS = [
  ["allowHighres", "admin.edit.opt.highres"],
  ["allowWeb", "admin.edit.opt.web"],
  ["allowIg", "admin.edit.opt.ig"],
  ["allowBulk", "admin.edit.opt.bulk"],
] as const;

type OptionsData = Pick<
  GalleryEditData,
  "photoCount" | "wmCount" | "hasWmFiles" | "hasThumbWmFiles"
>;

/** One radio of the mode fieldset, with its explanatory note. */
function ModeOption({
  mode,
  checked,
  label,
  note,
  onChange,
}: {
  mode: GalleryMode;
  checked: boolean;
  label: string;
  note: string;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <input
        id={`mode-${mode}`}
        type="radio"
        name="mode"
        value={mode}
        checked={checked}
        onChange={onChange}
        aria-describedby={`mode-${mode}-note`}
        className="mt-2.5 size-6 md:mt-1 md:size-4"
      />
      <div>
        <label
          htmlFor={`mode-${mode}`}
          className="text-small flex min-h-tap items-center md:min-h-0"
        >
          {label}
        </label>
        <p id={`mode-${mode}-note`} className="text-small text-grey-600">
          {note}
        </p>
      </div>
    </div>
  );
}

/** Delivery / proofing radios. */
function ModeFieldset({
  proofing,
  onMode,
}: {
  proofing: boolean;
  onMode: (m: GalleryMode) => void;
}) {
  const t = useT();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-small font-medium">
        {t("admin.edit.mode.legend")}
      </legend>
      <ModeOption
        mode="delivery"
        checked={!proofing}
        label={t("admin.mode.delivery")}
        note={t("admin.edit.mode.deliveryNote")}
        onChange={() => onMode("delivery")}
      />
      <ModeOption
        mode="proofing"
        checked={proofing}
        label={t("admin.mode.proofing")}
        note={t("admin.edit.mode.proofingNote")}
        onChange={() => onMode("proofing")}
      />
    </fieldset>
  );
}

function DownloadChecks({
  g,
  disabled,
}: {
  g: EditGallery;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <>
      {DOWNLOAD_OPTIONS.map(([name, key]) => (
        <Check
          key={name}
          name={name}
          label={t(key)}
          checked={g[name]}
          disabled={disabled}
        />
      ))}
    </>
  );
}

/** Proofing warnings: photos without a preview-wm, the home reminder, missing thumbnails. */
function ProofingNotes({ g, data }: { g: EditGallery; data: OptionsData }) {
  const t = useT();
  return (
    <>
      {data.wmCount === 0 && data.photoCount > 0 && (
        <p role="status" className="text-small text-ink font-medium">
          {t("admin.edit.mode.noWm", { count: data.photoCount })}
        </p>
      )}
      {data.wmCount > 0 && data.wmCount < data.photoCount && (
        <p role="status" className="text-small text-ink font-medium">
          {t("admin.edit.mode.someNoWm", {
            missing: data.photoCount - data.wmCount,
            count: data.photoCount,
          })}
        </p>
      )}
      {g.showOnHome && (
        <p role="status" className="text-small text-ink font-medium">
          {t("admin.edit.mode.homeReminder")}
          {data.wmCount === 0 && ` ${t("admin.edit.mode.homeNeedsWm")}`}
        </p>
      )}
      {data.hasWmFiles && !data.hasThumbWmFiles && (
        <p role="status" className="text-small text-grey-700">
          {t("admin.edit.mode.noThumbWm")}
        </p>
      )}
    </>
  );
}

export function OptionsSection({
  g,
  data,
  proofing,
  onMode,
  errors: fe,
  busy,
  actionData,
}: {
  g: EditGallery;
  data: OptionsData;
  proofing: boolean;
  onMode: (m: GalleryMode) => void;
  errors: FieldErrors;
  busy: boolean;
  actionData: GalleryActionResult | undefined;
}) {
  const t = useT();

  return (
    <Section title={t("admin.edit.section.options")}>
      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="flags" />
        <ModeFieldset proofing={proofing} onMode={onMode} />
        {fe.mode && (
          <p role="alert" className="text-small text-ink font-medium">
            {fe.mode}
          </p>
        )}
        {proofing && <ProofingNotes g={g} data={data} />}
        <DownloadChecks g={g} disabled={proofing} />
        {proofing && (
          <p className="text-small text-grey-600">
            {t("admin.edit.opt.proofingNote")}
          </p>
        )}
        <Check
          name="requireEmail"
          label={t("admin.edit.opt.requireEmail")}
          checked={g.requireEmail}
        />
        <p className="text-small text-grey-600">
          {t("admin.edit.opt.revokeNote")}
        </p>
        <div>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {t("admin.edit.opt.save")}
          </button>
        </div>
        <Feedback data={actionData} intent="flags" />
      </Form>
    </Section>
  );
}
