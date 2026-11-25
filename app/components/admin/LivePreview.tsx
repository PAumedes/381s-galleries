import { useId, useRef } from "react";
import type { ReactNode } from "react";

import type { Focus } from "../../lib/cover-focus";
import {
  type CoverLayout,
  type GridGap,
  type GridStyle,
  type Palette,
} from "../../lib/design";
import type { PreviewDevice } from "../../lib/preview-device";
import type { Versions } from "../img-url";
import { DeviceToggle, PreviewFooter } from "./LivePreviewParts";
import { PreviewFrame, VIEWPORTS } from "./PreviewFrame";
import { PreviewPage } from "./PreviewPage";

export { coverPlaceholderSrc, coverSrc } from "./PreviewCover";

export type { PreviewDevice };
export type CoverSpec = {
  id: string;
  aspect: number | null;
  focus: Focus | null;
};
export type PreviewPhoto = {
  id: string;
  set: string;
  width?: number | null;
  height?: number | null;
};

export type LivePreviewProps = {
  title: string;
  eventDate: string | null;
  palette: Palette;
  coverLayout: CoverLayout;
  gridStyle?: GridStyle;
  gridGap?: GridGap;
  proofing: boolean;
  /** Desktop cover (also the mobile one when `mobileCover` is null). */
  cover: CoverSpec | null;
  mobileCover?: CoverSpec | null;
  /** The gallery photos: shown as the real grid below the cover. Null = cover only. */
  photos?: readonly PreviewPhoto[] | null;
  /** Admin image tokens by photo id (`?v=`: privately cacheable URLs). */
  versions?: Versions;
  device: PreviewDevice;
  onDevice: (d: PreviewDevice) => void;
  heading?: string;
  hint?: string;
  headingLevel?: 2 | 3;
  /** Under the frame (e.g. the "sin guardar" bar). */
  children?: ReactNode;
};

/**
 * "Así se ve": the real client page (the same CoverHero and Grid the public
 * gallery uses, with the gallery's own photos) rendered at a desktop or phone
 * width inside a frame and scaled to fit. Driven by unsaved form values, so
 * every change shows at once. Inert: nothing inside can be focused or
 * clicked; the page scrolls (wheel, or keyboard on the focusable frame).
 */
export function LivePreview({
  onDevice,
  heading,
  hint,
  headingLevel = 2,
  children,
  ...page
}: LivePreviewProps) {
  const headingId = useId();
  const { device, photos, proofing, palette } = page;
  const vp = VIEWPORTS[photos ? "page" : "cover"][device];
  const viewportRef = useRef<HTMLDivElement>(null);

  return (
    <section
      data-testid="live-preview"
      aria-labelledby={heading ? headingId : undefined}
      className="flex min-w-0 flex-col gap-3"
    >
      <PreviewHeading
        id={headingId}
        heading={heading}
        level={headingLevel}
        hint={hint}
      />
      <DeviceToggle device={device} onDevice={onDevice} />
      <PreviewFrame
        device={device}
        vp={vp}
        scrollable={!!photos}
        viewportRef={viewportRef}
      >
        <PreviewPage vp={vp} {...page} />
      </PreviewFrame>
      <PreviewFooter
        palette={palette}
        proofing={proofing}
        showJump={!!photos}
        onJump={(to) =>
          viewportRef.current?.scrollTo?.({
            top: to === "grid" ? vp.h : 0,
            behavior: "smooth",
          })
        }
      />
      {children}
    </section>
  );
}

function PreviewHeading({
  id,
  heading,
  level,
  hint,
}: {
  id: string;
  heading?: string;
  level: 2 | 3;
  hint?: string;
}) {
  const H = heading ? (level === 2 ? "h2" : "h3") : null;
  if (!H && !hint) return null;
  return (
    <div className="flex flex-col gap-1">
      {H && (
        <H id={id} className="text-micro text-ink uppercase">
          {heading}
        </H>
      )}
      {hint && <p className="text-small text-grey-600">{hint}</p>}
    </div>
  );
}
