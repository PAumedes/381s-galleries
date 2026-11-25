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
import { useImgUrl } from "./img-url";
import type { GalleryPhoto } from "./types";

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

/** Width of the element (floored, ignoring 0), `initial` until measured (SSR). */
function useElementWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
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
  return { ref, width };
}

function layoutFor(
  style: GridStyle,
  photos: readonly GalleryPhoto[],
  opts: { containerWidth: number; gap: number },
) {
  return style === "cuadricula"
    ? squareLayout(photos.length, opts)
    : style === "columnas"
      ? columnsLayout(photos, opts)
      : justify(photos, opts);
}

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
  const { ref, width } = useElementWidth(initialWidth);
  // Every layout lists tiles in photo order and places them so that
  // (top, left) reading order equals that order: the lightbox (which walks
  // `photos`) always matches what the visitor sees.
  const layout = useMemo(
    () => layoutFor(style, photos, { containerWidth: width, gap }),
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

/** Load / error / retry state of one tile's thumbnail. */
function useTileImage() {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  // Images that finished loading before hydration never fire onLoad.
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);
  return {
    loaded,
    failed,
    retry,
    imgRef,
    onLoad: () => setLoaded(true),
    onError: () => setFailed(true),
    onRetry: () => {
      setFailed(false);
      setRetry((n) => n + 1);
    },
  };
}

function Tile(props: TileProps) {
  const { photo, index, box, t, onFavorite, onDownload } = props;
  const img = useTileImage();
  const label = t("grid.photo", { n: index + 1 });
  const imgUrl = useImgUrl();
  const thumb = imgUrl(photo.id, "thumb", photo.v);
  const hasActions = Boolean(onFavorite || onDownload);

  const open = (e: MouseEvent<HTMLButtonElement>) => {
    // Safari does not focus buttons on click; the lightbox restores focus here.
    e.currentTarget.focus();
    props.onOpen(index);
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
      <TileImage
        index={index}
        label={label}
        src={thumb}
        retry={img.retry}
        loaded={img.loaded}
        protect={props.protect}
        onOpen={open}
        onLoad={img.onLoad}
        onError={img.onError}
        imgRef={img.imgRef}
      />
      {img.failed && (
        <RetryButton
          index={index}
          label={t("lightbox.retry")}
          onRetry={img.onRetry}
        />
      )}
      {hasActions && (
        <TileHoverActions
          t={t}
          photoId={photo.id}
          favorite={props.favorite}
          onFavorite={onFavorite}
          onDownload={onDownload}
        />
      )}
    </div>
  );
}

function RetryButton({
  index,
  label,
  onRetry,
}: {
  index: number;
  label: string;
  onRetry: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`retry-${index}`}
      aria-label={label}
      className="absolute bottom-1 left-1 flex size-11 items-center justify-center text-grey-500 hover:text-grey-900"
      onClick={onRetry}
    >
      <Retry className="size-5" aria-hidden="true" />
    </button>
  );
}

/** Favourite / download buttons over a tile (fine pointers; touch uses the lightbox). */
function TileHoverActions({
  t,
  photoId,
  favorite,
  onFavorite,
  onDownload,
}: {
  t: TFunction;
  photoId: string;
  favorite: boolean;
  onFavorite?: (id: string) => void;
  onDownload?: (id: string) => void;
}) {
  return (
    <div className="absolute top-0 right-0 flex pointer-coarse:hidden bg-linear-to-bl from-black/40 to-transparent transition-opacity duration-base ease-out-soft pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
      {onFavorite && (
        <button
          type="button"
          className={ACTION}
          aria-label={t(favorite ? "favorites.remove" : "favorites.add")}
          aria-pressed={favorite}
          onClick={() => onFavorite(photoId)}
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
          onClick={() => onDownload(photoId)}
        >
          <Download width={20} height={20} />
        </button>
      )}
    </div>
  );
}

/** The thumbnail button (opens the lightbox) with its loading fade and proofing shield. */
function TileImage({
  index,
  label,
  src,
  retry,
  loaded,
  protect,
  onOpen,
  onLoad,
  onError,
  imgRef,
}: {
  index: number;
  label: string;
  src: string;
  retry: number;
  loaded: boolean;
  protect: boolean;
  onOpen: (e: MouseEvent<HTMLButtonElement>) => void;
  onLoad: () => void;
  onError: () => void;
  imgRef: (img: HTMLImageElement | null) => void;
}) {
  return (
    <button
      type="button"
      data-testid={`open-${index}`}
      aria-label={label}
      onClick={onOpen}
      className="absolute inset-0 block size-full cursor-zoom-in"
    >
      <img
        ref={imgRef}
        key={retry}
        src={`${src}${retry ? `${src.includes("?") ? "&" : "?"}r=${retry}` : ""}`}
        alt={label}
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={onLoad}
        onError={onError}
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
  );
}
