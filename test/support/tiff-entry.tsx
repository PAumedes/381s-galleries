// Bundled by vite for the real-Chrome test of the TIFF placeholder card (T6.53d):
// the real GalleryView (grid + lightbox + download sheet) with a TIFF-only photo
// between two ordinary ones. location.hash: es|en, optionally `,prueba`.
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { GalleryView } from "../../app/components/GalleryView";
import type { GalleryPhoto, OpenGallery } from "../../app/components/types";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { setFallbackMessages } from "../../app/i18n/fallback";

const hash = location.hash.slice(1).split(",");
const lang = hash.includes("en") ? "en" : "es";
const proofing = hash.includes("prueba");
const messages = lang === "en" ? en : es;
setFallbackMessages(messages);

const base = {
  width: 3000,
  height: 2000,
  set: "Fotos",
  variants: { web: true, ig: false },
};
const LONG = `${"IMG_0001_retocada_final_".repeat(4)}.tif`;
const photos: GalleryPhoto[] = [
  { ...base, id: "p0", v: "a1" },
  {
    id: "t1",
    width: null,
    height: null,
    set: "Fotos",
    variants: { web: false, ig: false },
    noPreview: true,
    tiff: { name: LONG, bytes: 312 * 1024 * 1024 },
  },
  { ...base, id: "p2", v: "c1" },
  {
    id: "t3",
    width: null,
    height: null,
    set: "Fotos",
    variants: { web: false, ig: false },
    noPreview: true,
    tiff: { name: "IMG_0003.tif", bytes: null },
  },
];
const gallery: OpenGallery = {
  slug: "retoque",
  requireEmail: false,
  title: "Retoque",
  eventDate: "2026-03-14",
  coverPhotoId: "p0",
  allowBulk: !proofing,
  allowHighres: !proofing,
  allowWeb: false,
  allowIg: false,
  mode: proofing ? "proofing" : "delivery",
  palette: "claro",
  coverLayout: "completa",
  gridStyle: "filas",
  gridGap: "normal",
  sets: [{ name: "Fotos", count: photos.length }],
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
