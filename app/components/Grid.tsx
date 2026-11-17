import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import type { GridStyle } from "../lib/design";
import { columnsLayout, squareLayout } from "../lib/grid-layout";
import { justify } from "../lib/justify";
import type { TFunction } from "../i18n/t";
import { Download, Heart, HeartFilled, Retry } from "./icons";
import { imgUrl, type GalleryPhoto } from "./types";

/** Width used for server rendering and before the first measurement. */
export const DEFAULT_GRID_WIDTH = 1200;
/** Default gutter (Normal). */
const GAP = 6;

export type GridProps = {
  photos: readonly GalleryPhoto[];
  t: TFunction;
  onOpen: (index: number) => void;
  onFavorite?: (id: string) => void;
  onDownload?: (id: string) => void;
  isFavorite?: (id: string) => boolean;
  initialWidth?: number;
  /** Filas (justified rows, default), Cuadricula (squares) or Columnas (masonry). */
  layout?: GridStyle;
  /** Gutter in px (2 / 6 / 16). */
  gap?: number;
  /** Proofing: block "Save image" (overlay above each photo, no context menu). */
  protect?: boolean;
};

const ACTION =
  "flex size-11 items-center justify-center text-white/90 hover:text-white";

export function Grid({
  photos,
  t,
  onOpen,
  onFavorite,
  onDownload,
  isFavorite,
  initialWidth = DEFAULT_GRID_WIDTH,
  layout: style = "filas",
  gap = GAP,
  protect = false,
}: GridProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initialWidth);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (w: number) => {
      const next = Math.floor(w);
      if (next > 0) setWidth(next);
    };
    apply(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) apply(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Every layout lists tiles in photo order and places them so that
  // (top, left) reading order equals that order: the lightbox (which walks
  // `photos`) always matches what the visitor sees.
  const layout = useMemo(
    () =>
      style === "cuadricula"
        ? squareLayout(photos.length, { containerWidth: width, gap })
        : style === "columnas"
          ? columnsLayout(photos, { containerWidth: width, gap })
          : justify(photos, { containerWidth: width, gap }),
    [photos, width, style, gap],
  );

  return (
    <div
      ref={ref}
      className={`relative w-full${protect ? " img-protect" : ""}`}
      style={{ height: `${layout.height}px` }}
      onContextMenu={protect ? (e) => e.preventDefault() : undefined}
    >
      {layout.tiles.map((tile) => {
        const photo = photos[tile.index];
        return (
          <Tile
            key={photo.id}
            photo={photo}
            index={tile.index}
            box={tile}
            t={t}
            onOpen={onOpen}
            onFavorite={onFavorite}
            onDownload={onDownload}
            favorite={isFavorite?.(photo.id) ?? false}
            protect={protect}
          />
        );
      })}
    </div>
  );
}

type TileProps = {
  photo: GalleryPhoto;
  index: number;
  box: { left: number; top: number; width: number; height: number };
  t: TFunction;
  onOpen: (index: number) => void;
  onFavorite?: (id: string) => void;
  onDownload?: (id: string) => void;
  favorite: boolean;
  protect: boolean;
};

function Tile({
  photo,
  index,
  box,
  t,
  onOpen,
  onFavorite,
  onDownload,
  favorite,
  protect,
}: TileProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  // Images that finished loading before hydration never fire onLoad.
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);
  const label = t("grid.photo", { n: index + 1 });
  const hasActions = Boolean(onFavorite || onDownload);

  const open = (e: MouseEvent<HTMLButtonElement>) => {
    // Safari does not focus buttons on click; the lightbox restores focus here.
    e.currentTarget.focus();
    onOpen(index);
  };

  return (
    <div
      data-testid={`tile-${index}`}
      className="group absolute bg-grey-100"
      style={{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }}
    >
      <button
        type="button"
        data-testid={`open-${index}`}
        aria-label={label}
        onClick={open}
        className="absolute inset-0 block size-full cursor-zoom-in"
      >
        <img
          ref={imgRef}
          key={retry}
          src={`${imgUrl(photo.id, "thumb", photo.v)}${retry ? `${imgUrl(photo.id, "thumb", photo.v).includes("?") ? "&" : "?"}r=${retry}` : ""}`}
          alt={label}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`block size-full object-cover transition-opacity duration-slow ease-out-soft motion-reduce:transition-none ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
        {protect && (
          <span
            data-testid={`shield-${index}`}
            aria-hidden="true"
            className="absolute inset-0"
            onContextMenu={(e) => e.preventDefault()}
          />
        )}
      </button>
      {failed && (
        <button
          type="button"
          data-testid={`retry-${index}`}
          aria-label={t("lightbox.retry")}
          className="absolute bottom-1 left-1 flex size-11 items-center justify-center text-grey-500 hover:text-grey-900"
          onClick={() => {
            setFailed(false);
            setRetry((n) => n + 1);
          }}
        >
          <Retry className="size-5" aria-hidden="true" />
        </button>
      )}
      {/* Touch devices: actions live in the lightbox to keep the grid clean. */}
      {hasActions && (
        <div className="absolute top-0 right-0 flex pointer-coarse:hidden bg-linear-to-bl from-black/40 to-transparent transition-opacity duration-base ease-out-soft pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
          {onFavorite && (
            <button
              type="button"
              className={ACTION}
              aria-label={t(favorite ? "favorites.remove" : "favorites.add")}
              aria-pressed={favorite}
              onClick={() => onFavorite(photo.id)}
            >
              {favorite ? (
                <HeartFilled width={20} height={20} />
              ) : (
                <Heart width={20} height={20} />
              )}
            </button>
          )}
          {onDownload && (
            <button
              type="button"
              className={ACTION}
              aria-label={t("download.title")}
              onClick={() => onDownload(photo.id)}
            >
              <Download width={20} height={20} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
