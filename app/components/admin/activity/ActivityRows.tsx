import { useState } from "react";

import { useFormat } from "../../../i18n/use-format";
import { useT } from "../../../i18n/use-t";
import { SIZE_KEYS, bulkTitle } from "../../../lib/admin-activity";
import { PhotoCell, VisitorCells, Who } from "./cells";
import { rowCls, td } from "./styles";
import type { Row } from "./types";

export function ActivityRows({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const { dateTimeOrEmpty } = useFormat();
  const sizeLabel = (variant: string) =>
    Object.hasOwn(SIZE_KEYS, variant) ? t(SIZE_KEYS[variant]!) : variant;
  const common = (x: Row) => (
    <>
      <td role="cell" className={td} data-label={t("admin.activity.col.when")}>
        {dateTimeOrEmpty(x.createdAt)}
      </td>
      <td role="cell" className={td} data-label={t("admin.activity.col.who")}>
        <Who email={x.email} />
      </td>
    </>
  );
  const tail = (x: Row) => (
    <>
      <td role="cell" className={td} data-label={t("admin.activity.col.size")}>
        {sizeLabel(x.variant)}
      </td>
      <VisitorCells x={x} />
    </>
  );
  if (!r.bulk) {
    return (
      <tr role="row" className={rowCls}>
        {common(r)}
        <td
          role="cell"
          className={td}
          data-label={t("admin.activity.col.what")}
        >
          <PhotoCell r={r} />
        </td>
        {tail(r)}
      </tr>
    );
  }
  const { bulk } = r;
  return (
    <>
      <tr role="row" className={rowCls}>
        {common(r)}
        <td
          role="cell"
          className={td}
          data-label={t("admin.activity.col.what")}
        >
          <span className="flex flex-wrap items-center gap-3">
            <span>{bulkTitle(bulk.scope, bulk.count, t)}</span>
            {bulk.children.length > 0 ? (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="text-micro border-ink border px-2 py-0.5 uppercase"
              >
                {open ? t("admin.hidePhotos") : t("admin.showPhotos")}
              </button>
            ) : null}
          </span>
        </td>
        {tail(r)}
      </tr>
      {open
        ? bulk.children.map((c) => (
            <tr key={c.id} role="row" className={`${rowCls} bg-grey-100`}>
              <td
                role="cell"
                className={td}
                data-label={t("admin.activity.col.when")}
              >
                {dateTimeOrEmpty(c.createdAt)}
              </td>
              <td
                role="cell"
                aria-hidden="true"
                className={`${td} text-grey-700 hidden md:table-cell`}
              >
                ↳
              </td>
              <td
                role="cell"
                className={td}
                data-label={t("admin.activity.col.what")}
              >
                <PhotoCell r={c} />
              </td>
              {tail(c)}
            </tr>
          ))
        : null}
    </>
  );
}
