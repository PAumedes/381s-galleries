import { useT } from "../../../i18n/use-t";
import {
  DEVICE_KEYS,
  placeLabel,
  softwareLabel,
  sourceLabel,
  type VisitorDisplay,
} from "../../../lib/admin-activity";
import { td } from "./styles";
import type { Row } from "./types";

export function Who({ email }: { email: string | null }) {
  const t = useT();
  return email ? (
    <>{email}</>
  ) : (
    <span className="text-grey-700">{t("admin.anon")}</span>
  );
}

export function PhotoCell({ r }: { r: Row }) {
  const t = useT();
  if (!r.photoId) return <span className="text-grey-700">—</span>;
  return (
    <span className="flex items-center gap-3">
      <img
        src={`/admin/img/${r.photoId}/thumb`}
        alt={r.name ?? ""}
        loading="lazy"
        className="bg-grey-200 h-10 w-10 object-cover"
      />
      <span>{r.name ?? t("admin.photoDeleted")}</span>
    </span>
  );
}

/** Place, device and source cells shared by download rows and visit rows. */
export function VisitorCells({ x }: { x: VisitorDisplay }) {
  const t = useT();
  const device =
    x.device && Object.hasOwn(DEVICE_KEYS, x.device)
      ? t(DEVICE_KEYS[x.device]!)
      : null;
  const software = softwareLabel(x);
  return (
    <>
      <td role="cell" className={td} data-label={t("admin.activity.col.place")}>
        {placeLabel(x) || "—"}
      </td>
      <td
        role="cell"
        className={td}
        data-label={t("admin.activity.col.device")}
      >
        {device || software ? (
          <>
            {device}
            {device && software ? <br /> : null}
            <span className="text-grey-700">{software}</span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td
        role="cell"
        className={td}
        data-label={t("admin.activity.col.source")}
      >
        {sourceLabel(x) || "—"}
      </td>
    </>
  );
}
