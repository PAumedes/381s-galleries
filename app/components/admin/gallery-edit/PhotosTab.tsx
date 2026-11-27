import { ISSUE_KEYS } from "../../../lib/admin-gallery";
import { useT } from "../../../i18n/use-t";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import { PhotoReorder } from "../PhotoReorder";
import { ApprovalsSection } from "./ApprovalsSection";
import type { EditGallery, GalleryEditData } from "./types";
import { Feedback, Section } from "./ui";

/** The sync issues, grouped by kind, with the count of those not listed. */
function IssueGroups({ issues }: { issues: GalleryEditData["issues"] }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      {issues.groups.map((grp) => (
        <div key={grp.type}>
          <h3 className="text-small font-medium">
            {Object.hasOwn(ISSUE_KEYS, grp.type)
              ? t(ISSUE_KEYS[grp.type]!)
              : t("admin.issue.other")}{" "}
            ({grp.items.length})
          </h3>
          <ul className="text-small text-grey-700 mt-1 list-disc pl-5">
            {grp.items.map((it, i) => (
              <li key={i}>
                {it.set ? `${it.set} / ` : ""}
                {it.name}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {issues.truncated > 0 && (
        <p className="text-small text-grey-600">
          {t("admin.edit.issues.more", {
            count: issues.truncated,
          })}
        </p>
      )}
    </div>
  );
}

/** Fotos tab: the reorderable grid with cover actions, and the sync issues. */
export function PhotosTab({
  data,
  g,
  coverId,
  actionData,
}: {
  data: Pick<GalleryEditData, "photos" | "version" | "issues" | "approvals">;
  g: EditGallery;
  coverId: string | null;
  actionData: GalleryActionResult | undefined;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-10">
      <Section title={t("admin.edit.section.photos")}>
        {data.photos.length === 0 ? (
          <p className="text-small text-grey-600">
            {t("admin.edit.photos.empty")}
          </p>
        ) : (
          <>
            <PhotoReorder
              key={data.photos.map((p) => p.id).join(",")}
              photos={data.photos}
              version={data.version}
              coverPhotoId={coverId}
              coverAuto={g.coverPhotoId === null}
              mobileCoverId={g.coverPhotoIdMobile ?? null}
              actionData={actionData}
            />
            <Feedback data={actionData} intent="cover" />
          </>
        )}
      </Section>
      {data.approvals && <ApprovalsSection summary={data.approvals} />}
      <Section title={t("admin.edit.section.issues")}>
        {data.issues.total === 0 ? (
          <p className="text-small text-grey-600">
            {t("admin.edit.issues.none")}
          </p>
        ) : (
          <IssueGroups issues={data.issues} />
        )}
      </Section>
    </div>
  );
}
