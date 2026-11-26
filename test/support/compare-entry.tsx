// Bundled by vite for the real-Chrome test of the version compare (T6.53e): the
// real GalleryView with every image replaced by an inline SVG whose size
// depends on the version (so the two previews letterbox differently), no network.
// Location hash: `#es` / `#en`, plus `&fail2` to break the v2 preview.
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { GalleryView } from "../../app/components/GalleryView";
import { ImgUrlProvider } from "../../app/components/img-url";
import type { GalleryPhoto, OpenGallery } from "../../app/components/types";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { setFallbackMessages } from "../../app/i18n/fallback";

const hash = location.hash.slice(1).split("&");
const lang = hash[0] === "en" ? "en" : "es";
const messages = lang === "en" ? en : es;
setFallbackMessages(messages);

/** v1 portrait 600x900, v2 square 800x800, v3+ landscape 1200x800. */
const SIZES: Record<number, [number, number, string]> = {
  1: [600, 900, "#a33"],
  2: [800, 800, "#3a3"],
  3: [1200, 800, "#33a"],
};
const svg = (n: number) => {
  const [w, h, fill] = SIZES[n] ?? SIZES[3];
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/><text x="40" y="120" font-size="100" fill="#fff">v${n}</text></svg>`,
  )}`;
};
const imgUrl = (_id: string, _variant: string, _v?: string, ver?: number) =>
  ver !== undefined && hash.includes(`fail${ver}`)
    ? "data:image/png;base64,AAAA"
    : svg(ver ?? 3);

const base = {
  width: 1200,
  height: 800,
  set: "Fotos",
  variants: { web: true, ig: false },
};
const v = (n: number, round: number | null) => ({
  n,
  round,
  at: `2026-03-0${n}T15:00:00.000Z`,
  v: `t${n}`,
});
const photos: GalleryPhoto[] = [
  {
    ...base,
    id: "p0",
    v: "t3",
    ver: 3,
    versions: [v(1, null), v(2, 2), v(3, 3)],
  },
  { ...base, id: "p1", v: "u1" },
  { ...base, id: "p2", v: "w1" },
];
const gallery: OpenGallery = {
  slug: "retoque",
  requireEmail: false,
  title: "Retoque",
  eventDate: "2026-03-14",
  coverPhotoId: "p0",
  allowBulk: false,
  allowHighres: false,
  allowWeb: false,
  allowIg: false,
  mode: "delivery",
  palette: "claro",
  coverLayout: "completa",
  gridStyle: "filas",
  gridGap: "normal",
  sets: [{ name: "Fotos", count: 3 }],
  round: 3,
};

const router = createMemoryRouter([
  {
    id: "root",
    path: "/",
    loader: () => ({ lang, messages, studioName: "381 Studios" }),
    Component: () => (
      <ImgUrlProvider value={imgUrl}>
        <GalleryView gallery={gallery} photos={photos} />
      </ImgUrlProvider>
    ),
  },
]);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
