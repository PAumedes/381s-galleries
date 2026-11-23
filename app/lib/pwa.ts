import { DEFAULT_STUDIO_NAME } from "./default-studio-name";
import { galleryPath } from "./gallery-path";
import { PALETTE_COLORS, isDarkPalette, type Palette } from "./design";
import type { GalleryData } from "./server/gallery";

type MetaTag = Record<string, string>;
export const THEME_COLORS = PALETTE_COLORS;
export const GENERIC_MANIFEST = "/manifest.webmanifest";
export const galleryManifestPath = (slug: string) =>
  `/api/g/${encodeURIComponent(slug)}/manifest.webmanifest`;

const ICONS = [
  {
    src: "/icons/icon-192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/icons/icon-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/icons/maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const cut = (s: string) =>
  Array.from(segmenter.segment(s.normalize("NFC").trim()), (x) => x.segment)
    .slice(0, 12)
    .join("")
    .trim();

/** Home-screen label: at most 12 graphemes (NFC), never empty. */
export function shortName(
  name: string,
  fallback = DEFAULT_STUDIO_NAME,
): string {
  return cut(name) || cut(fallback);
}

/** Web app manifest. No gallery → the generic studio one (start_url "/"). */
export function buildManifest(o: {
  studio: string;
  /** `title` omitted (PIN gallery): generic name, slug-specific scope. */
  gallery?: {
    slug: string;
    /** Owning client's slug: the app scopes to `/<client>/<album>/`. */
    clientSlug?: string | null;
    title?: string;
    palette: Palette;
  };
}) {
  const g = o.gallery;
  const color = THEME_COLORS[g?.palette ?? "claro"];
  const path = g ? galleryPath(g.slug, g.clientSlug) : "/";
  return {
    ...(g ? { id: path } : {}),
    name: g?.title || o.studio,
    short_name: shortName(g?.title ?? o.studio, o.studio),
    start_url: g ? `${path}/?source=pwa` : "/",
    ...(g ? { scope: `${path}/` } : {}),
    display: "standalone",
    background_color: color,
    theme_color: color,
    icons: ICONS,
  };
}

/**
 * Head tags for installability. Only public (no PIN) open galleries get their
 * own manifest; everything else links the generic one (no title leak, locked
 * == unavailable == unknown).
 */
export function pwaMeta(
  data: GalleryData | undefined,
  o: { studio: string },
): MetaTag[] {
  const pub = data?.state === "open" && data.og ? data : undefined;
  const palette: Palette =
    data?.state === "open"
      ? data.gallery.palette
      : data?.state === "locked"
        ? data.palette
        : "claro";
  // Locked/PIN pages still follow their theme for the status bar.
  const title = pub ? pub.gallery.title : o.studio;
  const slug = pub
    ? pub.gallery.slug
    : data?.state === "locked"
      ? data.slug
      : undefined;
  return [
    {
      tagName: "link",
      rel: "manifest",
      href: slug ? galleryManifestPath(slug) : GENERIC_MANIFEST,
    },
    { name: "theme-color", content: THEME_COLORS[palette] },
    { name: "mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-capable", content: "yes" },
    {
      name: "apple-mobile-web-app-status-bar-style",
      content: isDarkPalette(palette) ? "black-translucent" : "default",
    },
    { name: "apple-mobile-web-app-title", content: shortName(title, o.studio) },
  ];
}
