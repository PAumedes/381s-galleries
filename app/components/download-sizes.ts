import type { TKey } from "../i18n/t";
import type { DlVariant } from "../lib/download-client";
import type { GalleryPhoto, OpenGallery } from "./types";

const SIZES: { variant: DlVariant; key: TKey }[] = [
  { variant: "highres", key: "download.highres" },
  { variant: "web", key: "download.web" },
  { variant: "ig", key: "download.ig" },
];

const allowed = (g: OpenGallery, v: DlVariant) =>
  v === "highres" ? g.allowHighres : v === "web" ? g.allowWeb : g.allowIg;

export const hasVariant = (p: GalleryPhoto, v: DlVariant) =>
  v === "highres" || Boolean(p.variants?.[v]);

/** Sizes the gallery allows (optionally narrowed to what a photo has). */
export const enabledSizes = (g: OpenGallery, photo?: GalleryPhoto) =>
  SIZES.filter(
    (s) => allowed(g, s.variant) && (!photo || hasVariant(photo, s.variant)),
  );
