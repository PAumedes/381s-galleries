import { coverObjectPosition } from "../lib/cover-focus";
import { formatEventDate } from "../lib/event-date";
import { galleryPath } from "../lib/gallery-path";
import type { ClientTile } from "../lib/server/home";
import { useLang, useT } from "../i18n/use-t";
import { Lock } from "./icons";
import { imgUrl } from "./types";

// Tiles are 4:3 at every width; only the ratio matters for the crop.
const FRAME = { w: 4, h: 3 };

/**
 * Grid of album tiles shared by the public home and the client homepage. A tile
 * without a cover (PIN album on a client page) shows a lock instead of a photo.
 */
export function AlbumGrid({
  items,
  label,
}: {
  items: ClientTile[];
  label: string;
}) {
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3"
    >
      {items.map((it) => (
        <li key={it.slug} className="min-w-0">
          <AlbumTile item={it} />
        </li>
      ))}
    </ul>
  );
}

function AlbumTile({ item: it }: { item: ClientTile }) {
  const t = useT();
  const lang = useLang();
  const date = formatEventDate(it.eventDate, lang);
  return (
    <a
      href={galleryPath(it.slug, it.clientSlug)}
      className="group focus-visible:outline-ink flex min-h-12 flex-col gap-3 focus-visible:outline-2 focus-visible:outline-offset-4"
    >
      <span className="bg-grey-100 text-grey-600 flex aspect-[4/3] w-full items-center justify-center overflow-hidden">
        {it.cover ? (
          <TileImage title={it.title} cover={it.cover} />
        ) : (
          <Lock title={t("client.locked")} width={40} height={40} />
        )}
      </span>
      <span className="flex flex-col gap-1">
        <span
          aria-hidden={it.cover ? "true" : undefined}
          className="text-body text-start [overflow-wrap:anywhere] underline-offset-4 group-hover:underline"
        >
          {it.title}
        </span>
        {date && (
          <span className="text-micro-label text-grey-600 uppercase">
            {date}
          </span>
        )}
      </span>
    </a>
  );
}

function TileImage({
  title,
  cover,
}: {
  title: string;
  cover: NonNullable<ClientTile["cover"]>;
}) {
  const pos = coverObjectPosition(cover.focus, cover.aspect, FRAME);
  return (
    <img
      src={imgUrl(cover.id, "view-sm", cover.v)}
      alt={title}
      width={800}
      height={600}
      loading="lazy"
      decoding="async"
      draggable={false}
      style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
      className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
    />
  );
}
