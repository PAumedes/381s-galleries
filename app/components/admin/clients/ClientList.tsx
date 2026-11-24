import { Form, Link } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { ClientActionResult } from "../../../lib/server/admin-clients";
import { Feedback, Field } from "../gallery-edit/ui";
import { SubmitButton } from "./SubmitButton";
import { CLIENT_INPUT, WRAP } from "./ui";

export interface ClientListItem {
  id: string;
  name: string;
  slug: string;
  pageEnabled: boolean;
  albumCount: number;
}

/** Cards below md, one grid row each from md up. */
const ROW =
  "flex min-h-12 flex-col gap-1 border border-grey-200 p-4 hover:bg-grey-50 focus-visible:outline-2 focus-visible:outline-ink md:grid md:min-h-0 md:grid-cols-[2fr_1.5fr_8rem_9rem] md:items-center md:gap-4 md:border-0 md:border-b md:px-3 md:py-3";

function CreateForm({ data }: { data: ClientActionResult | undefined }) {
  const t = useT();
  const errs = data?.intent === "create" ? data.fieldErrors : undefined;
  return (
    <Form
      method="post"
      className="border-grey-200 flex flex-col gap-3 border p-4"
    >
      <h2 className="text-micro text-grey-700 uppercase">
        {t("admin.clients.create.title")}
      </h2>
      <div className="flex flex-col gap-3 md:grid md:grid-cols-2">
        <Field label={t("admin.clients.field.name")} error={errs?.name}>
          {(p) => (
            <input
              {...p}
              name="name"
              required
              maxLength={120}
              autoComplete="off"
              data-compact
              className={CLIENT_INPUT}
            />
          )}
        </Field>
        <Field
          label={t("admin.clients.field.slug")}
          error={errs?.slug}
          hint={t("admin.clients.field.slugHintAuto")}
        >
          {(p) => (
            <input
              {...p}
              name="slug"
              maxLength={60}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              data-compact
              className={CLIENT_INPUT}
            />
          )}
        </Field>
      </div>
      <div>
        <SubmitButton
          intent="create"
          label={t("admin.clients.create.button")}
          pendingLabel={t("admin.clients.create.pending")}
        />
      </div>
      <Feedback data={errs ? data : undefined} intent="create" />
    </Form>
  );
}

function ClientRow({ c }: { c: ClientListItem }) {
  const t = useT();
  return (
    <li>
      <Link to={`/admin/clients/${c.id}`} className={ROW}>
        <span className={`${WRAP} font-medium`}>{c.name}</span>
        <span className={`${WRAP} text-small text-grey-600`}>/{c.slug}</span>
        <span className="text-small">
          {t("admin.clients.count", { count: c.albumCount })}
        </span>
        <span className="text-small text-grey-600">
          {c.pageEnabled
            ? t("admin.clients.page.on")
            : t("admin.clients.page.off")}
        </span>
      </Link>
    </li>
  );
}

export function ClientList({
  clients,
  message,
  actionData,
}: {
  clients: ClientListItem[];
  message: string | null;
  actionData: ClientActionResult | undefined;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title text-ink">{t("admin.clients.title")}</h1>
      {message && (
        <p role="status" className="border-ink border p-3 text-small">
          {message}
        </p>
      )}
      <CreateForm data={actionData} />
      {clients.length === 0 ? (
        <p className="text-body text-grey-600">{t("admin.clients.empty")}</p>
      ) : (
        <div className="flex flex-col">
          <div
            aria-hidden="true"
            className="text-micro text-grey-600 hidden gap-4 px-3 pb-2 uppercase md:grid md:grid-cols-[2fr_1.5fr_8rem_9rem]"
          >
            <span>{t("admin.clients.col.name")}</span>
            <span>{t("admin.clients.col.slug")}</span>
            <span>{t("admin.clients.col.albums")}</span>
            <span>{t("admin.clients.col.page")}</span>
          </div>
          <ul className="flex flex-col gap-2 md:gap-0">
            {clients.map((c) => (
              <ClientRow key={c.id} c={c} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
