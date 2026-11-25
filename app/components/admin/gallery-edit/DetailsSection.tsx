import type { FormEvent } from "react";
import { Form } from "react-router";

import type { TFunction } from "../../../i18n/t";

import { useT } from "../../../i18n/use-t";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import type { EditGallery, FieldErrors, GalleryEditData } from "./types";
import { ClientFolderField } from "./ClientFolderField";
import { btnPrimary, Feedback, Field, inputCls, Section } from "./ui";

/** Asks before saving a changed slug: the public link changes with it. */
const confirmSlugChange =
  (currentSlug: string, t: TFunction) => (ev: FormEvent<HTMLFormElement>) => {
    const slug = (
      ev.currentTarget.elements.namedItem("slug") as HTMLInputElement
    ).value
      .trim()
      .toLowerCase();
    if (slug !== currentSlug && !window.confirm(t("admin.edit.confirmSlug")))
      ev.preventDefault();
  };

/** The title (live, feeds the preview) and the public slug. */
function TitleAndSlug({
  g,
  errors: de,
  title,
  onTitle,
}: {
  g: EditGallery;
  errors: FieldErrors;
  title: string;
  onTitle: (v: string) => void;
}) {
  const t = useT();
  return (
    <>
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
    </>
  );
}

/** Expiry date and time (both optional), with their shared note and error. */
function ExpiryFields({
  g,
  error,
}: {
  g: EditGallery;
  error: string | undefined;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("admin.edit.field.expiresDate")}>
          {(p) => (
            <input
              {...p}
              type="date"
              name="expiresDate"
              defaultValue={g.expires?.date ?? ""}
              aria-invalid={error ? true : undefined}
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
              aria-invalid={error ? true : undefined}
              aria-describedby="expires-note"
              className={inputCls}
            />
          )}
        </Field>
      </div>
      <p id="expires-note" className="text-small text-grey-600">
        {t("admin.edit.hint.expires")}
      </p>
      {error && (
        <p role="alert" className="text-small text-ink font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

type DetailsSectionProps = {
  g: EditGallery;
  /** Client folders for the select (none + clients). */
  clients?: GalleryEditData["clients"];
  errors: FieldErrors;
  title: string;
  onTitle: (v: string) => void;
  eventDate: string;
  onEventDate: (v: string) => void;
  busy: boolean;
  actionData: GalleryActionResult | undefined;
};

export function DetailsSection({
  g,
  clients = [],
  errors: de,
  title,
  onTitle,
  eventDate,
  onEventDate,
  busy,
  actionData,
}: DetailsSectionProps) {
  const t = useT();

  return (
    <Section title={t("admin.edit.section.details")}>
      <Form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={confirmSlugChange(g.slug, t)}
      >
        <input type="hidden" name="intent" value="details" />
        <TitleAndSlug g={g} errors={de} title={title} onTitle={onTitle} />
        {(clients.length > 0 || g.clientId) && (
          <ClientFolderField g={g} clients={clients} error={de.clientId} />
        )}
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
        <ExpiryFields g={g} error={de.expires} />
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
