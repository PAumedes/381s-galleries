// Bundled by vite for the real-Chrome test of the versioned album (T6.53c): the
// real GalleryView (cover, grid, lightbox) on a payload with two retouch
// rounds. Language: location.hash (#es / #en).
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { GalleryView } from "../../app/components/GalleryView";
import type { GalleryPhoto, OpenGallery } from "../../app/components/types";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { setFallbackMessages } from "../../app/i18n/fallback";

const lang = location.hash === "#en" ? "en" : "es";
const messages = lang === "en" ? en : es;
setFallbackMessages(messages);

const base = {
  width: 3000,
  height: 2000,
  set: "Fotos",
  variants: { web: true, ig: false },
};
const photos: GalleryPhoto[] = [
  {
    ...base,
    id: "p0",
    v: "t3",
    ver: 3,
    isNew: true,
    versions: [
      { n: 1, round: null, at: "2026-03-01T15:00:00.000Z", v: "t1" },
      { n: 2, round: 2, at: "2026-03-05T15:00:00.000Z", v: "t2" },
      { n: 3, round: 3, at: "2026-03-09T15:00:00.000Z", v: "t3" },
    ],
  },
  {
    ...base,
    id: "p1",
    v: "u2",
    ver: 2,
    versions: [
      { n: 1, round: null, at: "2026-03-01T15:00:00.000Z", v: "u1" },
      { n: 2, round: 2, at: "2026-03-05T15:00:00.000Z", v: "u2" },
    ],
  },
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
    Component: () => <GalleryView gallery={gallery} photos={photos} />,
  },
]);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
