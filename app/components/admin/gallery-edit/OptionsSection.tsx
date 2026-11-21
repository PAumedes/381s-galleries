import type { GalleryMode } from "../../../lib/constants";
import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import type { EditGallery, FieldErrors, GalleryEditData } from "./types";
import { btnPrimary, Check, Feedback, Section } from "./ui";

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
  data: Pick<
    GalleryEditData,
    "photoCount" | "wmCount" | "hasWmFiles" | "hasThumbWmFiles"
  >;
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
        <fieldset className="flex flex-col gap-2">
          <legend className="text-small font-medium">
            {t("admin.edit.mode.legend")}
          </legend>
          <div className="flex items-start gap-2">
            <input
              id="mode-delivery"
              type="radio"
              name="mode"
              value="delivery"
              checked={!proofing}
              onChange={() => onMode("delivery")}
              aria-describedby="mode-delivery-note"
              className="mt-2.5 size-6 md:mt-1 md:size-4"
            />
            <div>
              <label
                htmlFor="mode-delivery"
                className="text-small flex min-h-tap items-center md:min-h-0"
              >
                {t("admin.mode.delivery")}
              </label>
              <p id="mode-delivery-note" className="text-small text-grey-600">
                {t("admin.edit.mode.deliveryNote")}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <input
              id="mode-proofing"
              type="radio"
              name="mode"
              value="proofing"
              checked={proofing}
              onChange={() => onMode("proofing")}
              aria-describedby="mode-proofing-note"
              className="mt-2.5 size-6 md:mt-1 md:size-4"
            />
            <div>
              <label
                htmlFor="mode-proofing"
                className="text-small flex min-h-tap items-center md:min-h-0"
              >
                {t("admin.mode.proofing")}
              </label>
              <p id="mode-proofing-note" className="text-small text-grey-600">
                {t("admin.edit.mode.proofingNote")}
              </p>
            </div>
          </div>
        </fieldset>
        {fe.mode && (
          <p role="alert" className="text-small text-ink font-medium">
            {fe.mode}
          </p>
        )}
        {proofing && data.wmCount === 0 && data.photoCount > 0 && (
          <p role="status" className="text-small text-ink font-medium">
            {t("admin.edit.mode.noWm", { count: data.photoCount })}
          </p>
        )}
        {proofing && data.wmCount > 0 && data.wmCount < data.photoCount && (
          <p role="status" className="text-small text-ink font-medium">
            {t("admin.edit.mode.someNoWm", {
              missing: data.photoCount - data.wmCount,
              count: data.photoCount,
            })}
          </p>
        )}
        {proofing && g.showOnHome && (
          <p role="status" className="text-small text-ink font-medium">
            {t("admin.edit.mode.homeReminder")}
            {data.wmCount === 0 && ` ${t("admin.edit.mode.homeNeedsWm")}`}
          </p>
        )}
        {proofing && data.hasWmFiles && !data.hasThumbWmFiles && (
          <p role="status" className="text-small text-grey-700">
            {t("admin.edit.mode.noThumbWm")}
          </p>
        )}
        <Check
          name="allowHighres"
          label={t("admin.edit.opt.highres")}
          checked={g.allowHighres}
          disabled={proofing}
        />
        <Check
          name="allowWeb"
          label={t("admin.edit.opt.web")}
          checked={g.allowWeb}
          disabled={proofing}
        />
        <Check
          name="allowIg"
          label={t("admin.edit.opt.ig")}
          checked={g.allowIg}
          disabled={proofing}
        />
        <Check
          name="allowBulk"
          label={t("admin.edit.opt.bulk")}
          checked={g.allowBulk}
          disabled={proofing}
        />
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
