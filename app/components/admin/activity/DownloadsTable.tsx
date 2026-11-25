import { useT } from "../../../i18n/use-t";
import { ActivityRows } from "./ActivityRows";
import { headCls, tableCls, th } from "./styles";
import type { ActivityViewData } from "./types";

export function DownloadsTable({ rows }: { rows: ActivityViewData["rows"] }) {
  const t = useT();
  return (
    <div className="overflow-x-auto">
      <table
        role="table"
        aria-label={t("admin.activity.downloads")}
        className={tableCls}
      >
        <thead role="rowgroup" className={headCls}>
          <tr role="row">
            <th scope="col" className={th}>
              {t("admin.activity.col.when")}
            </th>
            <th scope="col" className={th}>
              {t("admin.activity.col.who")}
            </th>
            <th scope="col" className={th}>
              {t("admin.activity.col.what")}
            </th>
            <th scope="col" className={th}>
              {t("admin.activity.col.size")}
            </th>
            <th scope="col" role="columnheader" className={th}>
              {t("admin.activity.col.place")}
            </th>
            <th scope="col" role="columnheader" className={th}>
              {t("admin.activity.col.device")}
            </th>
            <th scope="col" role="columnheader" className={th}>
              {t("admin.activity.col.source")}
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="block md:table-row-group">
          {rows.map((r) => (
            <ActivityRows key={r.id} r={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
