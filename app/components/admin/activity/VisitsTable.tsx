import { useFormat } from "../../../i18n/use-format";
import { useT } from "../../../i18n/use-t";
import { VisitorCells, Who } from "./cells";
import { headCls, rowCls, tableCls, td, th } from "./styles";
import type { ActivityViewData } from "./types";

export function VisitsTable({ views }: { views: ActivityViewData["views"] }) {
  const t = useT();
  const { dateTimeOrEmpty } = useFormat();
  return (
    <div className="overflow-x-auto">
      <table
        role="table"
        aria-label={t("admin.activity.visitsTable")}
        className={tableCls}
      >
        <thead role="rowgroup" className={headCls}>
          <tr role="row">
            <th scope="col" role="columnheader" className={th}>
              {t("admin.activity.col.date")}
            </th>
            <th scope="col" role="columnheader" className={th}>
              {t("admin.activity.visitor")}
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
          {views.map((v, i) => (
            <tr key={i} role="row" className={rowCls}>
              <td
                role="cell"
                className={td}
                data-label={t("admin.activity.col.date")}
              >
                {dateTimeOrEmpty(v.createdAt)}
              </td>
              <td
                role="cell"
                className={td}
                data-label={t("admin.activity.visitor")}
              >
                <Who email={v.email} />
              </td>
              <VisitorCells x={v} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
