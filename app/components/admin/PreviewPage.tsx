import type { LivePreviewProps } from "./LivePreview";
import { PreviewCover } from "./PreviewCover";
import { PreviewGrid } from "./PreviewGrid";

export type PreviewPageProps = Omit<
  LivePreviewProps,
  "onDevice" | "heading" | "hint" | "headingLevel" | "children"
> & { vp: { w: number; h: number } };

/** The inert client page inside the frame: the cover, then (optionally) the photo grid. */
export function PreviewPage({
  vp,
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
}: PreviewPageProps) {
  return (
    <div
      inert
      data-preview-page=""
      data-theme={palette}
      data-grid-style={gridStyle}
      data-grid-gap={gridGap}
      className="bg-paper text-ink pointer-events-none min-h-full select-none"
    >
      <div style={{ height: `${vp.h}px` }}>
        <PreviewCover
          cover={cover}
          mobileCover={mobileCover}
          preview={{
            title,
            eventDate,
            palette,
            coverLayout,
            proofing,
            versions,
            device,
          }}
        />
      </div>
      {photos && (
        <PreviewGrid
          photos={photos}
          proofing={proofing}
          versions={versions}
          gridStyle={gridStyle}
          gridGap={gridGap}
          width={vp.w}
        />
      )}
    </div>
  );
}
