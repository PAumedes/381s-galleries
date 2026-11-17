import { formatEventDate } from "./event-date";
import type { GalleryData } from "./server/gallery";

type MetaTag = Record<string, string>;

/**
 * Head tags for the gallery page. Link-preview bots (WhatsApp, Telegram,
 * iMessage, Facebook) don't keep cookies, so they only ever see the generic
 * variant for locked/unavailable/unknown galleries: studio name only, no
 * title, no image. Only public (no PIN) galleries expose title and cover.
 */
export function galleryMeta(
  data: GalleryData | undefined,
  o: { studio: string; lang: string; origin: string },
): MetaTag[] {
  const robots = { name: "robots", content: "noindex,nofollow" };
  const generic = (title: string): MetaTag[] => [
    { title },
    robots,
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: o.studio },
    { property: "og:title", content: o.studio },
    { property: "og:description", content: o.studio },
    { name: "twitter:card", content: "summary" },
  ];
  if (!data || data.state !== "open") return generic(o.studio);
  const { title } = data.gallery;
  if (!data.og) return generic(`${title} · ${o.studio}`);

  const date = formatEventDate(data.gallery.eventDate, o.lang);
  const tags: MetaTag[] = [
    { title: `${title} · ${o.studio}` },
    robots,
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: o.studio },
    { property: "og:title", content: title },
    {
      property: "og:description",
      content: date ? `${date} · ${o.studio}` : o.studio,
    },
    {
      property: "og:url",
      content: `${o.origin}/${encodeURIComponent(data.gallery.slug)}`,
    },
  ];
  const { coverId, width, height } = data.og;
  if (coverId) {
    tags.push({
      property: "og:image",
      content: `${o.origin}/img/${encodeURIComponent(coverId)}/view-sm`,
    });
    if (width && height) {
      tags.push(
        { property: "og:image:width", content: String(width) },
        { property: "og:image:height", content: String(height) },
      );
    }
    tags.push({ property: "og:image:alt", content: title });
  }
  tags.push({
    name: "twitter:card",
    content: coverId ? "summary_large_image" : "summary",
  });
  return tags;
}
