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
export function adminImgUrl(proofing: boolean, versions?: Versions): ImgUrlFn {
  return (id, variant) => {
    const base = variant === "thumb" ? "thumb" : "view-sm";
    return adminImgSrc(id, proofing ? `${base}-wm` : base, versions?.[id]);
  };
}

/** Per-photo admin image tokens (`EditPhoto.v`): id -> token. */
export type Versions = Readonly<Record<string, string | null | undefined>>;
export type AdminVariant = "thumb" | "view-sm" | "thumb-wm" | "view-sm-wm";

/**
 * `/admin/img/<id>/<variant>`, with `?v=<token>` when the photo has one. A
 * versioned URL lets the admin's browser keep the image (private, immutable:
 * the token changes with the file); without it the server says no-store.
 */
export function adminImgSrc(
  id: string,
  variant: AdminVariant,
  v?: string | null,
): string {
  const url = `/admin/img/${encodeURIComponent(id)}/${variant}`;
  return v ? `${url}?v=${encodeURIComponent(v)}` : url;
}

/** Tokens by photo id, for the photos of the editor. */
export function versionsOf(
  photos: readonly { id: string; v?: string | null }[],
): Versions {
  return Object.fromEntries(photos.map((p) => [p.id, p.v]));
}
