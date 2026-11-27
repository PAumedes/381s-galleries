import { useT } from "../../../i18n/use-t";
import type { GalleryEditData } from "./types";
import { Section } from "./ui";

/**
 * Versioned albums (T6.53f): "N of M photos approved in their latest version"
 * and how many are still to review. Counts only; nothing about who approved.
 */
export function ApprovalsSection({
  summary,
}: {
  summary: NonNullable<GalleryEditData["approvals"]>;
}) {
  const t = useT();
  if (summary.total === 0) return null;
  return (
    <Section title={t("admin.edit.section.approvals")}>
      <p className="text-small">
        <span>
          {t("admin.edit.approvals.summary", {
            approved: summary.approved,
            total: summary.total,
            count: summary.total,
          })}
        </span>
        {" · "}
        <span>
          {t("admin.edit.approvals.pending", { pending: summary.pending })}
        </span>
      </p>
      <p className="text-small text-grey-600">
        {t("admin.edit.approvals.hint")}
      </p>
    </Section>
  );
}
