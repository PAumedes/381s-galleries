import { Link } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { GalleryMode } from "../../../lib/constants";
import type { ClientActionResult } from "../../../lib/server/admin-clients";
import { galleryPath } from "../../../lib/gallery-path";
import { StatusPill } from "../GalleryListParts";
import { Section } from "../gallery-edit/ui";
import { ApplyDefaultsForm, DeleteClientForm } from "./ClientActions";
import { ClientDetailsForm } from "./ClientDetailsForm";
import { WRAP } from "./ui";

export interface ClientEditItem {
  id: string;
  name: string;
  slug: string;
  pageEnabled: boolean;
  defaultMode: GalleryMode;
  defaultShowOnHome: boolean;
}

export interface ClientAlbumItem {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published" | "archived";
  mode: GalleryMode;
}

function Albums({
  albums,
  clientSlug,
}: {
  albums: ClientAlbumItem[];
  clientSlug: string;
}) {
  const t = useT();
  if (albums.length === 0)
    return (
      <p className="text-body text-grey-600">
        {t("admin.clients.albumsEmpty")}
      </p>
    );
  return (
    <ul className="flex flex-col gap-2">
      {albums.map((a) => (
        <li key={a.id}>
          <Link
            to={`/admin/g/${a.id}`}
            className="border-grey-200 hover:bg-grey-50 flex min-h-12 flex-wrap items-center justify-between gap-2 border px-3 py-2"
          >
            <span className={`${WRAP} flex flex-col`}>
              <span className="font-medium">{a.title}</span>
              <span className="text-small text-grey-600">
                {galleryPath(a.slug, clientSlug)}
              </span>
            </span>
            <StatusPill status={a.status} proofing={a.mode === "proofing"} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ClientEditView({
  client,
  albums,
  actionData,
}: {
  client: ClientEditItem;
  albums: ClientAlbumItem[];
  actionData: ClientActionResult | undefined;
}) {
  const t = useT();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link
        to="/admin/clients"
        className="text-small flex min-h-12 items-center underline md:min-h-0"
      >
        {t("admin.clients.back")}
      </Link>
      <h1 className={`${WRAP} text-title text-ink`}>{client.name}</h1>
      <Section title={t("admin.clients.section.details")}>
        <ClientDetailsForm client={client} data={actionData} />
      </Section>
      <Section title={t("admin.clients.section.apply")}>
        <ApplyDefaultsForm data={actionData} />
      </Section>
      <Section title={t("admin.clients.section.albums")}>
        <Albums albums={albums} clientSlug={client.slug} />
      </Section>
      <Section title={t("admin.clients.section.danger")}>
        <DeleteClientForm slug={client.slug} data={actionData} />
      </Section>
    </div>
  );
}
