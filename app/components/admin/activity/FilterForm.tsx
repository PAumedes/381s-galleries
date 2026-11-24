import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import { SIZE_KEYS } from "../../../lib/admin-activity";
import { selectCls } from "./styles";
import type { ActivityViewData } from "./types";

export function FilterForm({ data }: { data: ActivityViewData }) {
  const t = useT();
  const f = data.filters;
  return (
    <Form method="get" className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-micro text-grey-700 uppercase">
          {t("admin.activity.visitor")}
        </span>
        <select name="visitor" defaultValue={f.visitor} className={selectCls}>
          <option value="">{t("admin.activity.all")}</option>
          <option value="anon">{t("admin.activity.anonOnly")}</option>
          {data.visitorOptions.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-micro text-grey-700 uppercase">
          {t("admin.activity.size")}
        </span>
        <select name="size" defaultValue={f.size} className={selectCls}>
          <option value="">{t("admin.activity.all")}</option>
          {Object.entries(SIZE_KEYS).map(([k, key]) => (
            <option key={k} value={k}>
              {t(key)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="text-micro border-ink border px-4 py-2 uppercase"
      >
        {t("admin.activity.filter")}
      </button>
    </Form>
  );
}
