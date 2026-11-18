import { useMemo, useState, useSyncExternalStore } from "react";

/** How the "Fotos" tiles show a picture: whole (letterboxed) or cropped fill. */
export type FitMode = "fit" | "fill";
export type TileSize = "s" | "m" | "l";
export interface FitPrefs {
  mode: FitMode;
  size: TileSize;
}

export const DEFAULT_PREFS: FitPrefs = { mode: "fit", size: "m" };
export const STORAGE_KEY = "381.photoFit";

/** Whole class names (Tailwind scans literals): columns per size. */
export const GRID_BY_SIZE: Record<TileSize, string> = {
  s: "grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]",
  m: "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))]",
  l: "grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(19rem,1fr))]",
};
export const FRAME_BY_MODE: Record<FitMode, string> = {
  fit: "aspect-[4/3]",
  fill: "aspect-square",
};
export const IMG_BY_MODE: Record<FitMode, string> = {
  fit: "object-contain",
  fill: "object-cover",
};

export function parsePrefs(raw: string | null): FitPrefs {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<FitPrefs> | null;
    return {
      mode: v?.mode === "fill" ? "fill" : "fit",
      size: v?.size === "s" || v?.size === "l" ? v.size : "m",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

const subscribe = () => () => {};
function snapshot(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The viewer's tile choice, remembered in localStorage (which may be missing,
 * full or blocked: every access is guarded; the choice then lasts for this
 * page view). The server and the first client render use the defaults.
 */
export function useFitPrefs(): [FitPrefs, (next: Partial<FitPrefs>) => void] {
  const stored = useSyncExternalStore(subscribe, snapshot, () => null);
  const [chosen, setChosen] = useState<string | null>(null);
  const prefs = useMemo(() => parsePrefs(chosen ?? stored), [chosen, stored]);
  function update(next: Partial<FitPrefs>) {
    const raw = JSON.stringify({ ...prefs, ...next });
    setChosen(raw);
    try {
      localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      /* not remembered beyond this page view */
    }
  }
  return [prefs, update];
}
