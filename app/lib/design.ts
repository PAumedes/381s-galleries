/**
 * Per-gallery client design (T6.5): colour palette, cover layout, grid style
 * and spacing. Enums only (validated server-side, CHECKed in D1). Typography
 * is always Montserrat: there is no font option.
 */

export const PALETTES = ["claro", "oscuro", "arena", "gris"] as const;
export const COVER_LAYOUTS = [
  "completa",
  "dividida",
  "centrada",
  "minima",
] as const;
export const GRID_STYLES = ["filas", "cuadricula", "columnas"] as const;
export const GRID_GAPS = ["compacto", "normal", "amplio"] as const;

export type Palette = (typeof PALETTES)[number];
export type CoverLayout = (typeof COVER_LAYOUTS)[number];
export type GridStyle = (typeof GRID_STYLES)[number];
export type GridGap = (typeof GRID_GAPS)[number];

export type Design = {
  palette: Palette;
  coverLayout: CoverLayout;
  gridStyle: GridStyle;
  gridGap: GridGap;
};

/** Gutter between tiles, in px. */
export const GAP_PX: Record<GridGap, number> = {
  compacto: 2,
  normal: 6,
  amplio: 16,
};

/** Page background per palette (PWA theme-color; equals `--color-paper`). */
export const PALETTE_COLORS: Record<Palette, string> = {
  claro: "#FAFAF8",
  oscuro: "#0B0B0B",
  arena: "#F4EFE8",
  gris: "#EDEEF0",
};

/** Dark palettes use the white logo and a dark status bar. */
export const isDarkPalette = (p: Palette): boolean => p === "oscuro";

export const isPalette = (v: unknown): v is Palette =>
  PALETTES.includes(v as Palette);
export const isCoverLayout = (v: unknown): v is CoverLayout =>
  COVER_LAYOUTS.includes(v as CoverLayout);
export const isGridStyle = (v: unknown): v is GridStyle =>
  GRID_STYLES.includes(v as GridStyle);
export const isGridGap = (v: unknown): v is GridGap =>
  GRID_GAPS.includes(v as GridGap);
