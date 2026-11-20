import type { RefObject } from "react";

import type { TFunction } from "../../i18n/t";
import { Retry } from "../icons";
import { useImgUrl } from "../img-url";
import type { GalleryPhoto } from "../types";
import { dragTransform } from "./motion";
import { photoImgProps } from "./srcset";
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
};

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
}: PhotoStageProps) {
  const imgUrl = useImgUrl();
  const image = usePhotoImage(photos, photo, isReady);
  const { loaded, failed, behind, retry } = image;
  const behindProps = behind && photoImgProps(imgUrl, behind);
  const own = photoImgProps(imgUrl, photo);
  const leaving = useSlide(stageRef, photos, index, dragX, isReady);
  const neighbour = dragX ? photos[index + (dragX < 0 ? 1 : -1)] : undefined;
  const neighbourProps =
    neighbour && isReady(neighbour) && photoImgProps(imgUrl, neighbour);
  const leavingProps = leaving && photoImgProps(imgUrl, leaving);
  const transform = dragTransform(dragX, dragY);
  return (
    <div
      ref={stageRef}
      data-testid="lightbox-stage"
      className="absolute inset-0 grid place-items-center overflow-hidden select-none"
      onClick={onClick}
    >
      {failed ? (
        <div
          role="status"
          data-testid="lightbox-error"
          className="flex flex-col items-center gap-2 text-sm text-white/60"
        >
          <span>{t("lightbox.loadError")}</span>
          <button
            type="button"
            className="flex min-h-11 cursor-pointer items-center gap-2 px-3 underline hover:text-white"
            onClick={image.onRetry}
          >
            <Retry className="size-4" aria-hidden="true" />
            {t("lightbox.retry")}
          </button>
        </div>
      ) : (
        <>
          {behindProps && (
            <img
              data-testid="lightbox-prev"
              src={behindProps.src}
              srcSet={behindProps.srcSet}
              sizes={behindProps.sizes}
              alt=""
              aria-hidden="true"
              draggable={false}
              className={`${PHOTO_BOX} pointer-events-none opacity-100`}
            />
          )}
          {neighbourProps && (
            <img
              data-testid="lightbox-neighbour"
              src={neighbourProps.src}
              srcSet={neighbourProps.srcSet}
              sizes={neighbourProps.sizes}
              alt=""
              aria-hidden="true"
              draggable={false}
              className={`${PHOTO_BOX} pointer-events-none`}
              style={{
                transform: `translateX(${dragX + (dragX < 0 ? 1 : -1) * window.innerWidth}px)`,
              }}
            />
          )}
          {leavingProps && (
            <img
              data-testid="lightbox-leaving"
              data-lb-photo
              data-lb-leaving
              src={leavingProps.src}
              srcSet={leavingProps.srcSet}
              sizes={leavingProps.sizes}
              alt=""
              aria-hidden="true"
              draggable={false}
              className={`${PHOTO_BOX} pointer-events-none`}
            />
          )}
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
              !dragX && !dragY
                ? "transition-[opacity,transform] duration-slow ease-out-soft"
                : "transition-opacity duration-slow"
            } motion-reduce:transition-none ${loaded ? "opacity-100" : "opacity-0"}`}
            style={{ transform }}
          />
          {protect && (
            <span
              data-testid="lightbox-shield"
              data-lb-photo
              aria-hidden="true"
              className="col-start-1 row-start-1 block h-full w-full"
              style={{ transform }}
              onContextMenu={(e) => e.preventDefault()}
            />
          )}
        </>
      )}
    </div>
  );
}
