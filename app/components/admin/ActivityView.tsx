import { Link } from "react-router";

import { useT } from "../../i18n/use-t";
import { Breakdown } from "./activity/Breakdown";
import { Card } from "./activity/Card";
import { DownloadsTable } from "./activity/DownloadsTable";
import { FilterForm } from "./activity/FilterForm";
import type { ActivityViewData } from "./activity/types";
import { VisitsTable } from "./activity/VisitsTable";
import { GalleryPageHeader } from "./GalleryPageHeader";
import { GalleryTabs } from "./GalleryTabs";

export type { ActivityViewData } from "./activity/types";

/** Visit, email-visitor and download counters. */
function SummaryCards({
  summary: s,
}: {
  summary: ActivityViewData["summary"];
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Card label={t("admin.activity.visits")} value={s.views} />
      <Card label={t("admin.activity.visitorsWithEmail")} value={s.visitors} />
      <Card label={t("admin.activity.photosDownloaded")} value={s.photos} />
      <Card label={t("admin.activity.fullDownloads")} value={s.bulks} />
    </div>
  );
}

function LatestVisits({ views }: { views: ActivityViewData["views"] }) {
  const t = useT();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-micro text-grey-700 uppercase">
        {t("admin.activity.latestVisits")}
      </h2>
      {views.length === 0 ? (
        <p className="text-small text-grey-700">
          {t("admin.activity.noVisits")}
        </p>
      ) : (
        <VisitsTable views={views} />
      )}
    </section>
  );
}

export function ActivityView({ data }: { data: ActivityViewData }) {
  const t = useT();
  const base = `/admin/g/${data.gallery.id}`;
  const f = data.filters;
  const moreQs = new URLSearchParams();
  if (f.visitor) moreQs.set("visitor", f.visitor);
  if (f.size) moreQs.set("size", f.size);
  if (data.next) moreQs.set("cursor", data.next);
  return (
    <div className="flex flex-col gap-8">
      <GalleryPageHeader title={data.gallery.title} />
      <GalleryTabs id={data.gallery.id} current="actividad" />

      <SummaryCards summary={data.summary} />

      <Breakdown data={data.breakdown} />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <FilterForm data={data} />
          <a
            href={`${base}/activity.csv`}
            data-tap
            className="text-micro border-ink border px-4 py-2 uppercase"
          >
            {t("admin.activity.exportCsv")}
          </a>
        </div>

        {data.rows.length === 0 ? (
          <p className="text-small text-grey-700">
            {t("admin.activity.noDownloads")}
          </p>
        ) : (
          <DownloadsTable rows={data.rows} />
        )}
        {data.next ? (
          <Link
            to={`${base}/activity?${moreQs.toString()}`}
            className="text-micro text-ink self-start underline uppercase"
          >
            {t("admin.activity.older")}
          </Link>
        ) : null}
      </section>

      <LatestVisits views={data.views} />
    </div>
  );
}
