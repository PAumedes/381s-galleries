import { makeT } from "../../app/i18n/t";
import { en } from "../../app/i18n/en";
import type { GalleryPhoto } from "../../app/components/types";

export const t = makeT("en", en);

export const photos = (n: number): GalleryPhoto[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    width: i % 3 === 2 ? 2000 : 3000,
    height: i % 3 === 2 ? 3000 : 2000,
    set: "A",
    variants: { web: true, ig: true },
  }));
