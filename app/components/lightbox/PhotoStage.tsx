import type { Ref } from "react";

import type { TFunction } from "../../i18n/t";
import { Retry } from "../icons";
import { useImgUrl } from "../img-url";
import type { GalleryPhoto } from "../types";
import { srcSetOf } from "./srcset";
import { usePhotoImage, withRetry } from "./usePhotoImage";

const SIZES = "(min-width: 768px) 92vw, 100vw";

type PhotoStageProps = {
  stageRef: Ref<HTMLDivElement>;
  t: TFunction;
  photos: readonly GalleryPhoto[];
  photo: GalleryPhoto;
  index: number;
  dragX: number;
  protect: boolean;
  onClick: React.MouseEventHandler<HTMLDivElement>;
};

/** The photo (with the previous one behind it), its error state and the proofing shield. */
export function PhotoStage({
  stageRef,
  t,
  photos,
  photo,
  index,
  dragX,
  protect,
  onClick,
}: PhotoStageProps) {
  const imgUrl = useImgUrl();
  const srcSet = srcSetOf(imgUrl);
  const image = usePhotoImage(photos, photo);
  const { loaded, failed, behind, retry } = image;
  return (
    <div
      ref={stageRef}
      data-testid="lightbox-stage"
      className="absolute inset-0 grid place-items-center select-none"
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
          {behind && (
            <img
              data-testid="lightbox-prev"
              src={imgUrl(behind.id, "view-sm", behind.v)}
              srcSet={srcSet(behind.id, behind.v)}
              sizes={SIZES}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="pointer-events-none col-start-1 row-start-1 block h-[80vh] w-screen object-contain opacity-100 md:h-[86vh] md:w-[92vw]"
            />
          )}
          <img
            key={`${photo.id}:${retry}`}
            ref={(el) => image.imgRef(el)}
            data-testid="lightbox-img"
            src={withRetry(imgUrl(photo.id, "view-sm", photo.v), retry)}
            srcSet={retry ? undefined : srcSet(photo.id, photo.v)}
            sizes={SIZES}
            alt={t("grid.photo", { n: index + 1 })}
            draggable={false}
            onLoad={() => image.onLoad()}
            onError={() => image.onError()}
            className={`col-start-1 row-start-1 block h-[80vh] w-screen object-contain md:h-[86vh] md:w-[92vw] ${
              dragX === 0
                ? "transition-[opacity,transform] duration-slow ease-out-soft"
                : "transition-opacity duration-slow"
            } motion-reduce:transition-none ${loaded ? "opacity-100" : "opacity-0"}`}
            style={{
              transform: dragX ? `translateX(${dragX}px)` : undefined,
            }}
          />
          {protect && (
            <span
              data-testid="lightbox-shield"
              aria-hidden="true"
              className="col-start-1 row-start-1 block h-full w-full"
              style={{
                transform: dragX ? `translateX(${dragX}px)` : undefined,
              }}
              onContextMenu={(e) => e.preventDefault()}
            />
          )}
        </>
      )}
    </div>
  );
}
