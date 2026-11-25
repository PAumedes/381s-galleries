import type {
  CoverLayout,
  GridGap,
  GridStyle,
  Palette,
} from "../../lib/design";

/** Schematic thumbnails are CSS/SVG only (no images). */
const FRAME = "h-14 w-full border border-grey-300";
const ph = "fill-grey-400";

/** [x, y, width, height, fill class] of one rectangle in the 80x52 thumbnail. */
type Rect = readonly [number, number, number, number, string];

const COVER_RECTS: Record<CoverLayout, readonly Rect[]> = {
  completa: [
    [0, 0, 80, 52, "fill-grey-700"],
    [24, 30, 32, 3, "fill-white"],
    [30, 36, 20, 2, "fill-white/70"],
  ],
  dividida: [
    [0, 0, 48, 52, "fill-grey-700"],
    [54, 20, 20, 3, "fill-grey-900"],
    [56, 27, 16, 2, "fill-grey-500"],
  ],
  centrada: [
    [10, 5, 60, 30, "fill-grey-700"],
    [26, 40, 28, 3, "fill-grey-900"],
    [32, 46, 16, 2, "fill-grey-500"],
  ],
  minima: [
    [22, 14, 36, 3, "fill-grey-900"],
    [30, 21, 20, 2, "fill-grey-500"],
    [4, 32, 22, 16, ph],
    [29, 32, 22, 16, ph],
    [54, 32, 22, 16, ph],
  ],
};

const GRID_RECTS: Record<GridStyle, readonly Rect[]> = {
  filas: [
    [4, 4, 30, 20, ph],
    [36, 4, 18, 20, ph],
    [56, 4, 20, 20, ph],
    [4, 27, 20, 21, ph],
    [26, 27, 28, 21, ph],
    [56, 27, 20, 21, ph],
  ],
  cuadricula: [0, 1].flatMap((r) =>
    [0, 1, 2, 3].map((c): Rect => [4 + c * 19, 5 + r * 23, 17, 20, ph]),
  ),
  columnas: [
    [4, 4, 22, 26, ph],
    [4, 33, 22, 15, ph],
    [29, 4, 22, 14, ph],
    [29, 21, 22, 27, ph],
    [54, 4, 22, 20, ph],
    [54, 27, 22, 21, ph],
  ],
};

/** Photos at the three spacings: 2 rows of 3 tiles, `g` apart. */
const gapRects = (g: number): Rect[] => {
  const size = (60 - 2 * g) / 3;
  return [0, 1].flatMap((r) =>
    [0, 1, 2].map((c): Rect => [
      10 + c * (size + g),
      (52 - (2 * 20 + g)) / 2 + r * (20 + g),
      size,
      20,
      ph,
    ]),
  );
};

/** A thumbnail frame with the given rectangles. */
function RectThumb({ rects }: { rects: readonly Rect[] }) {
  return (
    <span data-thumb="" aria-hidden="true" className={`${FRAME} bg-white`}>
      <svg viewBox="0 0 80 52" className="size-full">
        {rects.map(([x, y, width, height, className], i) => (
          <rect
            key={i}
            // A rect at the origin leaves x / y to the SVG default (0).
            x={x || undefined}
            y={y || undefined}
            width={width}
            height={height}
            className={className}
          />
        ))}
      </svg>
    </span>
  );
}

export function PaletteThumb({ value }: { value: Palette }) {
  return (
    <span
      data-thumb=""
      data-theme={value}
      aria-hidden="true"
      className={`${FRAME} bg-paper flex flex-col justify-center gap-1.5 px-3`}
    >
      <span className="bg-ink h-1.5 w-2/3" />
      <span className="bg-grey-600 h-1 w-full" />
      <span className="bg-grey-300 h-1 w-1/2" />
    </span>
  );
}

export const CoverThumb = ({ value }: { value: CoverLayout }) => (
  <RectThumb rects={COVER_RECTS[value]} />
);
export const GridThumb = ({ value }: { value: GridStyle }) => (
  <RectThumb rects={GRID_RECTS[value]} />
);
export const GapThumb = ({ value }: { value: GridGap }) => (
  <RectThumb
    rects={gapRects(value === "compacto" ? 1 : value === "normal" ? 3 : 7)}
  />
);
