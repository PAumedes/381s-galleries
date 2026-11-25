import type { MouseEvent, Ref } from "react";

import type { Focus } from "../lib/cover-focus";
import { MOBILE_COVER_MEDIA } from "../lib/preview-device";
import { isDarkPalette, type CoverLayout, type Palette } from "../lib/design";

import { CoverPhoto, type CoverImage } from "./CoverPhoto";
import {
  CentradaCover,
  CompletaCover,
  DividedaCover,
  MinimaCover,
  type CoverParts,
} from "./CoverLayouts";
import { Logo } from "./Logo";

export { MOBILE_COVER_MEDIA };
export type { CoverImage };

/**
 * The gallery cover (full-bleed photo, title, date, studio, scroll cue).
 * Used by the public gallery and by the admin live preview, so they cannot
 * drift. `embedded` is the preview flavour: it fills its box instead of the
 * viewport and is inert (no heading level, no real button).
 */
export function CoverHero({
  title,
  date,
  studio,
  src,
  srcSet,
  placeholder = null,
  proofing,
  focus,
  aspect = null,
  scrollLabel,
  onScroll,
  embedded = false,
  headerRef,
  layout = "completa",
  palette = "claro",
  mobile = null,
  device,
}: {
  title: string;
  date: string | null;
  studio: string;
  /** Cover image URL (null = no photo). */
  src: string | null;
  /** Width candidates of `src` (the browser picks by viewport and DPR); `src` is then the fallback. */
  srcSet?: string;
  /** Small version shown until `src` loads, then faded out (admin previews). */
  placeholder?: string | null;
  proofing: boolean;
  /** Focal point on the image (percent of its width/height); null = centered. */
  focus: Focus | null;
  /** Photo width / height; needed to place the focal point (null = centered). */
  aspect?: number | null;
  scrollLabel: string;
  onScroll?: () => void;
  embedded?: boolean;
  headerRef?: Ref<HTMLElement>;
  /** Cover layout (T6.5). Default: Completa (full-bleed photo). */
  layout?: CoverLayout;
  /** Palette: only the layouts that sit on the page background (not on the photo) use it. */
  palette?: Palette;
  /** Optional mobile cover (own photo and focal point) for narrow viewports. */
  mobile?: CoverImage | null;
  /**
   * Admin previews: render as this device (the preview frame is not the
   * viewport). Absent = decide by the viewport (`MOBILE_COVER_MEDIA`).
   */
  device?: "desktop" | "mobile";
}) {
  const Title = embedded ? "p" : "h1";
  const parts: CoverParts = {
    headerRef,
    box: embedded ? "h-full" : "h-dvh min-h-96",
    protect: proofing && layout !== "minima" ? " img-protect" : "",
    noMenu: proofing ? (e: MouseEvent) => e.preventDefault() : undefined,
    embedded,
    scroll: { embedded, label: scrollLabel, onScroll },
    photo: (
      <CoverPhoto
        src={src}
        srcSet={srcSet}
        placeholder={placeholder}
        focus={focus}
        aspect={aspect}
        mobile={mobile}
        device={device}
        embedded={embedded}
        layout={layout}
      />
    ),
    shield: proofing && (src || mobile) && (
      <span
        data-testid="cover-shield"
        aria-hidden="true"
        className="absolute inset-0"
        onContextMenu={(e) => e.preventDefault()}
      />
    ),
    logo: (
      <Logo
        variant={isDarkPalette(palette) ? "light" : "dark"}
        className="h-12"
      />
    ),
    titleBlock: (
      <>
        <Title className="text-display font-light uppercase">{title}</Title>
        {date && (
          <p className="text-body -mt-3 font-light tracking-wide">{date}</p>
        )}
        <p className="text-micro-label uppercase">{studio}</p>
      </>
    ),
  };
  if (layout === "dividida") return <DividedaCover {...parts} />;
  if (layout === "centrada") return <CentradaCover {...parts} />;
  if (layout === "minima") return <MinimaCover {...parts} />;
  return <CompletaCover {...parts} />;
}
