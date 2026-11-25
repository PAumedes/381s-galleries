import { useT } from "../../../i18n/use-t";
import type { EditGallery, GalleryEditData } from "./types";
import { Field } from "./ui";

/** Client folder select of the details form: no client, or one of the clients. */
export function ClientFolderField({
  g,
  clients,
  error,
}: {
  g: EditGallery;
  clients: GalleryEditData["clients"];
  error?: string;
}) {
  const t = useT();
  const pinned = clients.some((c) => c.id === g.clientId && c.hasPin);
  return (
    <>
      <Field
        label={t("admin.edit.field.clientFolder")}
        error={error}
        hint={t("admin.edit.hint.clientFolder")}
      >
        {(p) => (
          <select
            data-compact
            {...p}
            name="clientId"
            defaultValue={g.clientId ?? ""}
            className="border-grey-300 bg-white min-h-12 w-full border px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:min-h-10"
          >
            <option value="">{t("admin.edit.clientFolder.none")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {pinned && (
        <p role="note" className="text-small text-ink break-words">
          {t("admin.edit.clientFolder.pinWarning")}
        </p>
      )}
    </>
  );
}
