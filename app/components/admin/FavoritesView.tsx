import { useId, useState } from "react";

import { useFormat } from "../../i18n/use-format";
import { useT } from "../../i18n/use-t";
import { captureOneResult } from "../../lib/admin-activity";
import type { loadFavoritesAdmin } from "../../lib/server/admin-activity";
import { GalleryPageHeader } from "./GalleryPageHeader";
import { GalleryTabs } from "./GalleryTabs";

export type FavoritesViewData = NonNullable<
  Awaited<ReturnType<typeof loadFavoritesAdmin>>
>;
type Photo =
  | FavoritesViewData["all"][number]
  | FavoritesViewData["visitors"][number]["lists"][number]["photos"][number];

const btn =
  "text-micro border-ink border px-3 py-1.5 uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

function Thumbs({
  photos,
  picks,
}: {
  photos: (Photo & { picks?: number })[];
  picks?: boolean;
}) {
  const t = useT();
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
      {photos.map((p) => (
        <li
          key={p.id}
          className={`flex flex-col gap-1 ${p.hidden ? "opacity-40" : ""}`}
        >
          {p.hidden ? (
            <div className="bg-grey-200 aspect-square w-full" />
          ) : (
            <img
              src={`/admin/img/${p.id}/thumb`}
              alt={p.name}
              loading="lazy"
              className="bg-grey-200 aspect-square w-full object-cover"
            />
          )}
          <span className="text-small break-all">
            {p.name}
            {p.hidden ? ` ${t("admin.favorites.hidden")}` : ""}
          </span>
          {picks && p.picks !== undefined ? (
            <span className="text-micro text-grey-700">
              {t("admin.favorites.picks", { count: p.picks })}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Actions({
  photos,
  comma,
  href,
}: {
  photos: Photo[];
  comma: boolean;
  href: string;
}) {
  const t = useT();
  const [state, setState] = useState<"idle" | "ok" | "error">("idle");
  const [skipped, setSkipped] = useState<string[]>([]);
  const names = photos.filter((p) => !p.hidden).map((p) => p.name);
  async function copy() {
    try {
      const r = captureOneResult(names, comma ? "comma" : "space");
      setSkipped(r.skipped);
      await navigator.clipboard.writeText(r.text);
      setState("ok");
    } catch {
      setState("error");
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={btn} onClick={copy}>
        {t("admin.favorites.copyCapture")}
      </button>
      <a href={href} data-tap className={btn}>
        {t("admin.favorites.downloadTxt")}
      </a>
      <span role="status" className="text-small text-grey-700">
        {state === "ok"
          ? t("admin.favorites.copied")
          : state === "error"
            ? t("admin.favorites.copyFailed")
            : ""}
      </span>
      {skipped.length > 0 ? (
        <p role="status" className="text-small text-grey-700 w-full break-all">
          {t("admin.favorites.skipped", {
            count: skipped.length,
            names: skipped.join(", "),
          })}
        </p>
      ) : null}
    </div>
  );
}

function VisitorSection({
  v,
  base,
  comma,
}: {
  v: FavoritesViewData["visitors"][number];
  base: string;
  comma: boolean;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const { dateTimeOrEmpty } = useFormat();
  const photos = v.lists.flatMap((l) => l.photos);
  const seen = new Set<string>();
  const unique = photos.filter((p) => !seen.has(p.id) && seen.add(p.id));
  return (
    <section className="border-grey-200 flex flex-col gap-3 border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-body text-ink">
          {v.anon ? t("admin.anonId", { id: v.id.slice(0, 6) }) : v.label}
        </h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={btn}
        >
          {open ? t("admin.hidePhotos") : t("admin.showPhotos")}
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {v.lists.map((l) => (
          <li key={l.name} className="text-small flex flex-wrap gap-x-4">
            <span>{l.name}</span>
            <span>{t("admin.count.photos", { count: l.count })}</span>
            <span className="text-grey-700">{dateTimeOrEmpty(l.last)}</span>
          </li>
        ))}
      </ul>
      <Actions
        photos={unique}
        comma={comma}
        href={`${base}/favorites.txt?visitor=${encodeURIComponent(v.id)}`}
      />
      {open
        ? v.lists.map((l) => (
            <div key={l.name} className="flex flex-col gap-2">
              {v.lists.length > 1 ? (
                <h4 className="text-micro text-grey-700 uppercase">{l.name}</h4>
              ) : null}
              <Thumbs photos={l.photos} />
            </div>
          ))
        : null}
    </section>
  );
}

/** Every picked photo across visitors, with how many people picked each. */
function AllPicks({
  data,
  base,
  comma,
}: {
  data: FavoritesViewData;
  base: string;
  comma: boolean;
}) {
  const t = useT();
  const allId = useId();
  return (
    <section
      aria-labelledby={allId}
      className="border-ink flex flex-col gap-3 border p-4"
    >
      <h2 id={allId} className="text-micro text-ink uppercase">
        {t("admin.favorites.all")}
      </h2>
      <p className="text-small text-grey-700">
        {t("admin.favorites.total", {
          photos: t("admin.count.photos", { count: data.all.length }),
        })}
      </p>
      <Actions photos={data.all} comma={comma} href={`${base}/favorites.txt`} />
      <Thumbs photos={data.all} picks />
    </section>
  );
}

export function FavoritesView({ data }: { data: FavoritesViewData }) {
  const base = `/admin/g/${data.gallery.id}`;
  const [comma, setComma] = useState(false);
  const t = useT();
  return (
    <div className="flex flex-col gap-8">
      <GalleryPageHeader title={data.gallery.title} />
      <GalleryTabs id={data.gallery.id} current="favoritos" />

      {data.visitors.length === 0 ? (
        <p className="text-small text-grey-700">{t("admin.favorites.none")}</p>
      ) : (
        <>
          <label className="text-small flex items-center gap-2">
            <input
              type="checkbox"
              checked={comma}
              onChange={(e) => setComma(e.target.checked)}
            />
            {t("admin.favorites.comma")}
          </label>
          <p className="text-small text-grey-700">
            {t("admin.favorites.captureNote")}
          </p>

          <AllPicks data={data} base={base} comma={comma} />

          <div className="grid items-start gap-4 xl:grid-cols-2">
            {data.visitors.map((v) => (
              <VisitorSection key={v.id} v={v} base={base} comma={comma} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
