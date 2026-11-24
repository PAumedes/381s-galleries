import { useFormat } from "../../../i18n/use-format";
import { useT } from "../../../i18n/use-t";
import type { SetupActionData } from "./types";

export function SyncSummary({
  result,
}: {
  result: NonNullable<SetupActionData["result"]>;
}) {
  const t = useT();
  const { number } = useFormat();
  if (result.skipped === "no_root")
    return (
      <p role="status" className="text-small">
        {t("admin.setup.sync.noRoot")}
      </p>
    );
  if (result.skipped === "empty_root")
    return (
      <p role="status" className="text-small">
        {t("admin.setup.sync.emptyRoot")}
      </p>
    );
  if (result.skipped === "locked")
    return (
      <p role="status" className="text-small">
        {t("admin.setup.sync.locked")}
      </p>
    );
  return (
    <ul role="status" className="text-small text-grey-700">
      <li>
        {t("admin.setup.sync.galleries", {
          created: number(result.galleries.created),
          updated: number(result.galleries.updated),
          archived: number(result.galleries.archived),
        })}
      </li>
      <li>
        {t("admin.setup.sync.photos", {
          added: number(result.photos.added),
          updated: number(result.photos.updated),
          removed: number(result.photos.removed),
        })}
      </li>
      <li>{t("admin.setup.sync.issues", { n: number(result.issues) })}</li>
    </ul>
  );
}
