import { useState } from "react";

import { useFormat } from "../../../i18n/use-format";
import { useT } from "../../../i18n/use-t";
import { SIZE_KEYS, bulkTitle } from "../../../lib/admin-activity";
import { PhotoCell, VisitorCells, Who } from "./cells";
import { rowCls, td } from "./styles";
import type { Row } from "./types";

/** When and who: the first two cells of every row. */
function WhenWho({ x }: { x: Row }) {
  const t = useT();
  const { dateTimeOrEmpty } = useFormat();
  return (
    <>
      <td role="cell" className={td} data-label={t("admin.activity.col.when")}>
        {dateTimeOrEmpty(x.createdAt)}
      </td>
      <td role="cell" className={td} data-label={t("admin.activity.col.who")}>
        <Who email={x.email} />
      </td>
    </>
  );
}

/** Size and visitor details: the last cells of every row. */
function SizeAndVisitor({ x }: { x: Row }) {
  const t = useT();
  const sizeLabel = (variant: string) =>
    Object.hasOwn(SIZE_KEYS, variant) ? t(SIZE_KEYS[variant]!) : variant;
  return (
    <>
      <td role="cell" className={td} data-label={t("admin.activity.col.size")}>
        {sizeLabel(x.variant)}
      </td>
      <VisitorCells x={x} />
    </>
  );
}

function WhatCell({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <td role="cell" className={td} data-label={t("admin.activity.col.what")}>
      {children}
    </td>
  );
}

/** One photo of a bulk download, indented under its header row. */
function BulkChildRow({ c }: { c: Row }) {
  const t = useT();
  const { dateTimeOrEmpty } = useFormat();
  return (
    <tr role="row" className={`${rowCls} bg-grey-100`}>
      <td role="cell" className={td} data-label={t("admin.activity.col.when")}>
        {dateTimeOrEmpty(c.createdAt)}
      </td>
      <td
        role="cell"
        aria-hidden="true"
        className={`${td} text-grey-700 hidden md:table-cell`}
      >
        ↳
      </td>
      <WhatCell>
        <PhotoCell r={c} />
      </WhatCell>
      <SizeAndVisitor x={c} />
    </tr>
  );
}

export function ActivityRows({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  if (!r.bulk) {
    return (
      <tr role="row" className={rowCls}>
        <WhenWho x={r} />
        <WhatCell>
          <PhotoCell r={r} />
        </WhatCell>
        <SizeAndVisitor x={r} />
      </tr>
    );
  }
  const { bulk } = r;
  return (
    <>
      <tr role="row" className={rowCls}>
        <WhenWho x={r} />
        <WhatCell>
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
        </WhatCell>
        <SizeAndVisitor x={r} />
      </tr>
      {open
        ? bulk.children.map((c) => <BulkChildRow key={c.id} c={c} />)
        : null}
    </>
  );
}
