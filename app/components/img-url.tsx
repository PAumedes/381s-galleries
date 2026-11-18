import { createContext, useContext } from "react";

import { imgUrl, type ImgUrlFn } from "./types";

/**
 * Where gallery images come from. Clients use `/img` (access-checked,
 * versioned `?v=`); the admin previews provide `/admin/img` URLs instead
 * (`adminImgUrl`), so the same Grid/Lightbox/cover code renders drafts and
 * PIN galleries for the owner without any public access.
 */
const ImgUrlContext = createContext<ImgUrlFn>(imgUrl);

export const ImgUrlProvider = ImgUrlContext.Provider;

export function useImgUrl(): ImgUrlFn {
  return useContext(ImgUrlContext);
}

/**
 * Admin image URLs as a client would see them: in Prueba the watermarked
 * admin variants (`thumb-wm`, `view-sm-wm`), else the clean ones. The admin
 * route has no `view-lg` (2048 px): the 1200 px `view-sm` stands in. No `?v=`:
 * admin images are `no-store`.
 */
export function adminImgUrl(proofing: boolean): ImgUrlFn {
  return (id, variant) => {
    const base = variant === "thumb" ? "thumb" : "view-sm";
    return `/admin/img/${encodeURIComponent(id)}/${proofing ? `${base}-wm` : base}`;
  };
}
