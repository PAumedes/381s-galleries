import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import type { EditGallery, FieldErrors } from "./types";
import { btnPrimary, Feedback, Field, inputCls, Section } from "./ui";

export function DetailsSection({
  g,
  errors: de,
  title,
  onTitle,
  eventDate,
  onEventDate,
  busy,
  actionData,
}: {
  g: EditGallery;
  errors: FieldErrors;
  title: string;
  onTitle: (v: string) => void;
  eventDate: string;
  onEventDate: (v: string) => void;
  busy: boolean;
  actionData: GalleryActionResult | undefined;
}) {
  const t = useT();

  return (
    <Section title={t("admin.edit.section.details")}>
      <Form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={(ev) => {
          const slug = (
            ev.currentTarget.elements.namedItem("slug") as HTMLInputElement
          ).value
            .trim()
            .toLowerCase();
          if (slug !== g.slug && !window.confirm(t("admin.edit.confirmSlug")))
            ev.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="details" />
        <Field label={t("admin.edit.field.title")} error={de.title}>
          {(p) => (
            <input
              {...p}
              name="title"
              required
              maxLength={120}
              value={title}
              onChange={(ev) => onTitle(ev.target.value)}
              className={inputCls}
            />
          )}
        </Field>
        <Field
          label={t("admin.edit.field.slug")}
          error={de.slug}
          hint={t("admin.edit.hint.slug")}
        >
          {(p) => (
            <input
              {...p}
              name="slug"
              required
              maxLength={60}
              autoComplete="off"
              spellCheck={false}
              defaultValue={g.slug}
              className={inputCls}
            />
          )}
        </Field>
        <Field
          label={t("admin.edit.field.client")}
          error={de.clientName}
          hint={t("admin.edit.hint.client")}
        >
          {(p) => (
            <input
              {...p}
              name="clientName"
              maxLength={120}
              defaultValue={g.clientName ?? ""}
              className={inputCls}
            />
          )}
        </Field>
        <Field label={t("admin.edit.field.eventDate")} error={de.eventDate}>
          {(p) => (
            <input
              {...p}
              type="date"
              name="eventDate"
              value={eventDate}
              onChange={(ev) => onEventDate(ev.target.value)}
              className={inputCls}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("admin.edit.field.expiresDate")}>
              {(p) => (
                <input
                  {...p}
                  type="date"
                  name="expiresDate"
                  defaultValue={g.expires?.date ?? ""}
                  aria-invalid={de.expires ? true : undefined}
                  aria-describedby="expires-note"
                  className={inputCls}
                />
              )}
            </Field>
            <Field label={t("admin.edit.field.expiresTime")}>
              {(p) => (
                <input
                  {...p}
                  type="time"
                  name="expiresTime"
                  defaultValue={g.expires?.time ?? ""}
                  aria-invalid={de.expires ? true : undefined}
                  aria-describedby="expires-note"
                  className={inputCls}
                />
              )}
            </Field>
          </div>
          <p id="expires-note" className="text-small text-grey-600">
            {t("admin.edit.hint.expires")}
          </p>
          {de.expires && (
            <p role="alert" className="text-small text-ink font-medium">
              {de.expires}
            </p>
          )}
        </div>
        <div>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {t("admin.edit.saveDetails")}
          </button>
        </div>
        <Feedback data={actionData} intent="details" />
      </Form>
    </Section>
  );
}
