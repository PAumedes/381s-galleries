import { Form } from "react-router";

import { useT } from "../../i18n/use-t";
import { TOOL_BTN as tool } from "./FitControls";
import { btn } from "./gallery-edit/ui";

/** Per-set header: name, count, move-selected and sort buttons. */
export function SetToolbar({
  set,
  count,
  canBefore,
  canAfter,
  onBefore,
  onAfter,
  onSort,
}: {
  set: string;
  count: number;
  canBefore: boolean;
  canAfter: boolean;
  onBefore: () => void;
  onAfter: () => void;
  onSort: (mode: "date" | "name") => void;
}) {
  const t = useT();
  return (
    <div className="border-grey-200 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b pb-3">
      <p aria-hidden="true" className="flex items-baseline gap-2">
        <span className="text-micro text-ink uppercase">{set}</span>
        <span className="text-small text-grey-600">{count}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={tool}
          disabled={!canBefore}
          onClick={onBefore}
        >
          {t("admin.reorder.before")}
        </button>
        <button
          type="button"
          className={tool}
          disabled={!canAfter}
          onClick={onAfter}
        >
          {t("admin.reorder.after")}
        </button>
        <button type="button" className={tool} onClick={() => onSort("date")}>
          {t("admin.reorder.sortDate")}
        </button>
        <button type="button" className={tool} onClick={() => onSort("name")}>
          {t("admin.reorder.sortName")}
        </button>
      </div>
    </div>
  );
}

/** The save bar stays in view while the order has unsaved changes. */
export function ReorderSaveBar({
  version,
  orders,
  dirty,
  busy,
  onReset,
}: {
  version: string;
  orders: Record<string, string[]>;
  dirty: boolean;
  busy: boolean;
  onReset: () => void;
}) {
  const t = useT();
  return (
    <Form
      method="post"
      className={`bg-paper border-grey-200 z-10 flex flex-wrap items-center gap-2 border-t py-3 ${dirty ? "sticky bottom-0" : ""}`}
    >
      <input type="hidden" name="intent" value="reorder" />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="order" value={JSON.stringify(orders)} />
      <button
        type="submit"
        className={`${btn} bg-ink text-paper`}
        disabled={!dirty || busy}
      >
        {t("admin.reorder.save")}
      </button>
      <button type="button" className={btn} disabled={!dirty} onClick={onReset}>
        {t("admin.reorder.reset")}
      </button>
      {dirty && (
        <span className="text-small text-grey-700">
          {t("admin.reorder.unsaved")}
        </span>
      )}
    </Form>
  );
}
