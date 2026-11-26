import type { RefObject } from "react";

import type { TFunction } from "../../i18n/t";
import { Retry } from "../icons";
import { PreviewCardText, PreviewDownload } from "../PreviewCard";
import { useImgUrl } from "../img-url";
import type { GalleryPhoto } from "../types";
import { dragTransform } from "./motion";
import { photoImgProps, thumbSrc } from "./srcset";
import { useSlide } from "./useSlide";
import { usePhotoImage, withRetry } from "./usePhotoImage";

const PHOTO_BOX =
  "col-start-1 row-start-1 block h-[80vh] w-screen object-contain md:h-[86vh] md:w-[92vw]";

type PhotoStageProps = {
  stageRef: RefObject<HTMLDivElement | null>;
  t: TFunction;
  photos: readonly GalleryPhoto[];
  photo: GalleryPhoto;
  isReady: (photo: GalleryPhoto) => boolean;
  index: number;
  dragX: number;
  dragY: number;
  protect: boolean;
  onClick: React.MouseEventHandler<HTMLDivElement>;
  onDownload?: (id: string) => void;
};

type ImgProps = { src: string; srcSet?: string; sizes?: string };

/** A decorative, non-interactive photo layer; `leaving` marks it for the slide animation. */
function GhostImg({
  testId,
  props,
  leaving,
  photoMarker,
  className = "",
  style,
}: {
  testId?: string;
  props: ImgProps;
  leaving?: boolean;
  /** Also animated with the photos (`data-lb-photo`). */
  photoMarker?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <img
      data-testid={testId}
      data-lb-photo={photoMarker || leaving || undefined}
      data-lb-leaving={leaving || undefined}
      src={props.src}
      srcSet={props.srcSet}
      sizes={props.sizes}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`${PHOTO_BOX} pointer-events-none ${className}`.trimEnd()}
      style={style}
    />
  );
}

/** Shown instead of the photo when it failed to load, with a retry button. */
function LoadError({ t, onRetry }: { t: TFunction; onRetry: () => void }) {
  return (
    <div
      role="status"
      data-testid="lightbox-error"
      className="flex flex-col items-center gap-2 text-sm text-white/60"
    >
      <span>{t("lightbox.loadError")}</span>
      <button
        type="button"
        className="flex min-h-11 cursor-pointer items-center gap-2 px-3 underline hover:text-white"
        onClick={onRetry}
      >
        <Retry className="size-4" aria-hidden="true" />
        {t("lightbox.retry")}
      </button>
    </div>
  );
}

/** A transparent layer over the photo so a long-press / right-click cannot save it (proofing). */
function Shield({ transform }: { transform: string | undefined }) {
  return (
    <span
      data-testid="lightbox-shield"
      data-lb-photo
      aria-hidden="true"
      className="col-start-1 row-start-1 block h-full w-full"
      style={{ transform }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

type PhotoImage = ReturnType<typeof usePhotoImage>;

/** The current photo: thumbnail placeholder, the full image (cross-fades in), and the proofing shield. */
function CurrentPhoto({
  t,
  photo,
  index,
  image,
  drag,
  protect,
}: {
  t: TFunction;
  photo: GalleryPhoto;
  index: number;
  image: PhotoImage;
  drag: { x: number; y: number };
  protect: boolean;
}) {
  const imgUrl = useImgUrl();
  const { loaded, retry } = image;
  const own = photoImgProps(imgUrl, photo);
  const transform = dragTransform(drag.x, drag.y);
  return (
    <>
      {/* Under the full photo: the crossfade has something to fade over. */}
      <img
        data-testid="lightbox-placeholder"
        data-lb-photo
        src={thumbSrc(imgUrl, photo)}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`${PHOTO_BOX} pointer-events-none`}
        style={{ transform }}
      />
      <img
        key={`${photo.id}:${retry}`}
        data-lb-photo
        ref={(el) => image.imgRef(el)}
        data-testid="lightbox-img"
        src={withRetry(own.src, retry)}
        srcSet={retry ? undefined : own.srcSet}
        sizes={own.sizes}
        alt={t("grid.photo", { n: index + 1 })}
        draggable={false}
        onLoad={() => image.onLoad()}
        onError={() => image.onError()}
        className={`${PHOTO_BOX} ${
          !drag.x && !drag.y
            ? "transition-[opacity,transform] duration-slow ease-out-soft"
            : "transition-opacity duration-slow"
        } motion-reduce:transition-none ${loaded ? "opacity-100" : "opacity-0"}`}
        style={{ transform }}
      />
      {protect && <Shield transform={transform} />}
    </>
  );
}

/** The photos around the current one: the previous (until the new one loads), the one under the finger, the one sliding out. */
function GhostLayers({
  behind,
  neighbour,
  leaving,
  dragX,
  isReady,
}: {
  behind: GalleryPhoto | undefined;
  neighbour: GalleryPhoto | undefined;
  leaving: GalleryPhoto | undefined;
  dragX: number;
  isReady: (photo: GalleryPhoto) => boolean;
}) {
  const imgUrl = useImgUrl();
  // Under the finger: the full photo when preloaded, else its thumbnail.
  const neighbourProps = neighbour && {
    ...photoImgProps(imgUrl, neighbour),
    ...(!isReady(neighbour) && {
      src: thumbSrc(imgUrl, neighbour),
      srcSet: undefined,
    }),
  };
  return (
    <>
      {behind && (
        <GhostImg
          testId="lightbox-prev"
          props={photoImgProps(imgUrl, behind)}
          className="opacity-100"
        />
      )}
      {neighbourProps && (
        <GhostImg
          testId="lightbox-neighbour"
          props={neighbourProps}
          style={{
            transform: `translateX(${dragX + (dragX < 0 ? 1 : -1) * window.innerWidth}px)`,
          }}
        />
      )}
      {leaving && (
        <GhostImg props={{ src: thumbSrc(imgUrl, leaving) }} leaving />
      )}
      {leaving && (
        <GhostImg
          testId="lightbox-leaving"
          props={photoImgProps(imgUrl, leaving)}
          leaving
          photoMarker
        />
      )}
    </>
  );
}

/**
 * The current photo when it has no image to show (T6.53d, a TIFF-only photo):
 * the placeholder card with the original's name and size and, where downloads
 * are on, its download button. Nothing is requested from `/img`.
 */
function PreviewCard({
  t,
  photo,
  onDownload,
}: {
  t: TFunction;
  photo: GalleryPhoto;
  onDownload?: (id: string) => void;
}) {
  return (
    <div
      data-testid="lightbox-preview-card"
      data-lb-photo
      className="col-start-1 row-start-1 flex w-72 max-w-[80vw] flex-col items-center gap-4 border border-white/20 px-4 py-10 text-white"
    >
      <PreviewCardText t={t} photo={photo} />
      {onDownload && (
        <PreviewDownload
          t={t}
          photoId={photo.id}
          onDownload={onDownload}
          className="flex min-h-11 cursor-pointer items-center gap-2 border border-white/40 px-4 text-small hover:bg-white/10"
        />
      )}
    </div>
  );
}

/** The photo (with the previous one behind it), its error state and the proofing shield. */
export function PhotoStage({
  stageRef,
  t,
  photos,
  photo,
  isReady,
  index,
  dragX,
  dragY,
  protect,
  onClick,
  onDownload,
}: PhotoStageProps) {
  const image = usePhotoImage(photos, photo, isReady);
  // Photos without an image never get an <img> layer (it would 404).
  const drawn = (p: GalleryPhoto | undefined) => (p?.noPreview ? undefined : p);
  const leaving = drawn(useSlide(stageRef, photos, index, dragX));
  const neighbour = drawn(
    dragX ? photos[index + (dragX < 0 ? 1 : -1)] : undefined,
  );
  return (
    <div
      ref={stageRef}
      data-testid="lightbox-stage"
      className="absolute inset-0 grid place-items-center overflow-hidden select-none"
      onClick={onClick}
    >
      {photo.noPreview ? (
        <PreviewCard t={t} photo={photo} onDownload={onDownload} />
      ) : image.failed ? (
        <LoadError t={t} onRetry={image.onRetry} />
      ) : (
        <>
          <GhostLayers
            behind={drawn(image.behind)}
            neighbour={neighbour}
            leaving={leaving}
            dragX={dragX}
            isReady={isReady}
          />
          <CurrentPhoto
            t={t}
            photo={photo}
            index={index}
            image={image}
            drag={{ x: dragX, y: dragY }}
            protect={protect}
          />
        </>
      )}
    </div>
  );
}
