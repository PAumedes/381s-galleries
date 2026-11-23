import { useNavigate } from "react-router";

import { useT } from "../../i18n/use-t";
import { CLIENT_FILTER_NONE } from "../../lib/admin-gallery";
import type { ClientChoice } from "../../lib/server/admin-galleries/client-choices";

/** Client filter of the album list: all / no client / one client (`?cliente=`). */
export function ClientFilter({
  clients,
  value,
  hrefFor,
}: {
  clients: ClientChoice[];
  value: string;
  /** List URL for a client filter value, keeping the status filter and search. */
  hrefFor: (clientFilter: string) => string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const known =
    value === "" ||
    value === CLIENT_FILTER_NONE ||
    clients.some((c) => c.id === value);
  return (
    <label className="flex max-w-xl flex-col gap-1">
      <span className="text-micro text-grey-600 uppercase">
        {t("admin.list.clientFilter.label")}
      </span>
      <select
        value={value}
        onChange={(ev) => void navigate(hrefFor(ev.target.value))}
        className="border-grey-300 bg-white min-h-12 w-full min-w-0 border px-3 text-base"
      >
        <option value="">{t("admin.list.clientFilter.all")}</option>
        <option value={CLIENT_FILTER_NONE}>
          {t("admin.list.clientFilter.none")}
        </option>
        {!known && <option value={value}>{value}</option>}
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
