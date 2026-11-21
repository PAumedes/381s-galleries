import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { localeFor } from "../../i18n/format";
import { useLang, useT } from "../../i18n/use-t";
import type { Focus } from "../../lib/cover-focus";
import {
  GAP_PX,
  type CoverLayout,
  type GridGap,
  type GridStyle,
  type Palette,
} from "../../lib/design";
import { formatEventDate } from "../../lib/event-date";
import type { PreviewDevice } from "../../lib/preview-device";
import { useStudioName } from "../../lib/use-studio-name";
import { CoverHero } from "../CoverHero";
import { Grid } from "../Grid";
import {
  adminImgSrc,
  adminImgUrl,
  ImgUrlProvider,
  type Versions,
} from "../img-url";
import type { GalleryPhoto } from "../types";
import { DeviceToggle, PreviewFooter } from "./LivePreviewParts";

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

/**
 * Virtual viewports the real page is laid out in, then scaled down. "cover"
 * = just the first screen (the cover); "page" = a scrollable page (cover,
 * then the grid).
 */
const VIEWPORTS = {
  cover: {
    desktop: { w: 1280, h: 720, ratio: "16 / 9" },
    mobile: { w: 390, h: 823, ratio: "9 / 19" },
  },
  page: {
    desktop: { w: 1280, h: 800, ratio: "16 / 10" },
    mobile: { w: 390, h: 844, ratio: "390 / 844" },
  },
} as const;

/** Admin URL of the cover image (the watermarked one in Prueba). */
export const coverSrc = (id: string, proofing: boolean, v?: string | null) =>
  adminImgSrc(id, proofing ? "view-sm-wm" : "view-sm", v);

/**
 * Small stand-in shown while the cover loads: the thumbnail (the watermarked
 * one in Prueba, never a clean file there). The photo grid and the cover
 * chooser load the same URL, so the browser has it already.
 */
export const coverPlaceholderSrc = (
  id: string,
  proofing: boolean,
  v?: string | null,
) => adminImgSrc(id, proofing ? "thumb-wm" : "thumb", v);

/**
 * "Así se ve": the real client page (the same CoverHero and Grid the public
 * gallery uses, with the gallery's own photos) rendered at a desktop or phone
 * width inside a frame and scaled to fit. Driven by unsaved form values, so
 * every change shows at once. Inert: nothing inside can be focused or
 * clicked; the page scrolls (wheel, or keyboard on the focusable frame).
 */
export function LivePreview({
  title,
  eventDate,
  palette,
  coverLayout,
  gridStyle = "filas",
  gridGap = "normal",
  proofing,
  cover,
  mobileCover = null,
  photos = null,
  versions,
  device,
  onDevice,
  heading,
  hint,
  headingLevel = 2,
  children,
}: {
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
}) {
  const t = useT();
  const lang = useLang();
  const studio = useStudioName();
  const headingId = useId();
  const kind = photos ? "page" : "cover";
  const vp = VIEWPORTS[kind][device];
  const boxRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setScale(el.clientWidth / vp.w);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vp.w]);

  const imgUrl = useMemo(
    () => adminImgUrl(proofing, versions),
    [proofing, versions],
  );
  const gridPhotos = useMemo<GalleryPhoto[] | null>(
    () =>
      photos
        ? photos.map((p) => ({
            id: p.id,
            set: p.set,
            width: p.width ?? null,
            height: p.height ?? null,
            variants: { web: true, ig: true },
          }))
        : null,
    [photos],
  );
  const gap = GAP_PX[gridGap];
  const H = heading ? (headingLevel === 2 ? "h2" : "h3") : null;

  return (
    <section
      data-testid="live-preview"
      aria-labelledby={heading ? headingId : undefined}
      className="flex min-w-0 flex-col gap-3"
    >
      {(H || hint) && (
        <div className="flex flex-col gap-1">
          {H && (
            <H id={headingId} className="text-micro text-ink uppercase">
              {heading}
            </H>
          )}
          {hint && <p className="text-small text-grey-600">{hint}</p>}
        </div>
      )}
      <DeviceToggle device={device} onDevice={onDevice} />
      <div
        className={
          device === "mobile"
            ? "border-grey-900 mx-auto w-full max-w-[17.5rem] overflow-hidden rounded-[1.75rem] border-[6px]"
            : "border-grey-300 w-full overflow-hidden border"
        }
      >
        {device === "desktop" && (
          <div
            aria-hidden="true"
            className="border-grey-200 bg-grey-100 flex h-5 items-center gap-1 border-b px-2"
          >
            <span className="bg-grey-300 size-1.5 rounded-full" />
            <span className="bg-grey-300 size-1.5 rounded-full" />
            <span className="bg-grey-300 size-1.5 rounded-full" />
          </div>
        )}
        <div
          ref={boxRef}
          data-frame={device}
          style={{ aspectRatio: vp.ratio }}
          className="relative w-full overflow-hidden"
        >
          <div
            ref={viewportRef}
            data-viewport=""
            tabIndex={photos ? 0 : undefined}
            aria-label={photos ? t("admin.preview.scroll") : undefined}
            style={{
              width: `${vp.w}px`,
              height: `${vp.h}px`,
              transform: `scale(${scale})`,
            }}
            className={`absolute top-0 left-0 origin-top-left overflow-x-hidden ${photos ? "overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "overflow-hidden"}`}
          >
            <div
              inert
              data-preview-page=""
              data-theme={palette}
              data-grid-style={gridStyle}
              data-grid-gap={gridGap}
              className="bg-paper text-ink pointer-events-none min-h-full select-none"
            >
              <div style={{ height: `${vp.h}px` }}>
                <CoverHero
                  embedded
                  layout={coverLayout}
                  palette={palette}
                  title={title}
                  date={formatEventDate(eventDate, localeFor(lang))}
                  studio={studio}
                  src={
                    cover
                      ? coverSrc(cover.id, proofing, versions?.[cover.id])
                      : null
                  }
                  placeholder={
                    cover
                      ? coverPlaceholderSrc(
                          cover.id,
                          proofing,
                          versions?.[cover.id],
                        )
                      : null
                  }
                  proofing={false}
                  focus={cover?.focus ?? null}
                  aspect={cover?.aspect ?? null}
                  mobile={
                    mobileCover
                      ? {
                          src: coverSrc(
                            mobileCover.id,
                            proofing,
                            versions?.[mobileCover.id],
                          ),
                          placeholder: coverPlaceholderSrc(
                            mobileCover.id,
                            proofing,
                            versions?.[mobileCover.id],
                          ),
                          focus: mobileCover.focus,
                          aspect: mobileCover.aspect,
                        }
                      : null
                  }
                  device={device}
                  scrollLabel={t("gallery.view")}
                />
              </div>
              {gridPhotos && (
                <div style={{ padding: gap > 6 ? gap : 4 }}>
                  <ImgUrlProvider value={imgUrl}>
                    <Grid
                      photos={gridPhotos}
                      t={t}
                      onOpen={() => {}}
                      layout={gridStyle}
                      gap={gap}
                      protect={proofing}
                      initialWidth={vp.w - 2 * (gap > 6 ? gap : 4)}
                    />
                  </ImgUrlProvider>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
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
