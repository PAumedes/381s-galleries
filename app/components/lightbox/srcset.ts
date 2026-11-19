import type { ImgUrlFn } from "../types";

export const srcSetOf = (imgUrl: ImgUrlFn) => (id: string, v?: string) => {
  const sm = imgUrl(id, "view-sm", v);
  const lg = imgUrl(id, "view-lg", v);
  // The admin preview has no 2048 px variant: a single candidate then.
  return lg === sm ? `${sm} 1200w` : `${sm} 1200w, ${lg} 2048w`;
};
