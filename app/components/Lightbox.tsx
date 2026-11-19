import { useEffect, useRef, useState } from "react";

import type { TFunction } from "../i18n/t";
import {
  ChevronLeft,
  ChevronRight,
  Close,
  Download,
  Heart,
  HeartFilled,
  Retry,
} from "./icons";
import { useImgUrl } from "./img-url";
import { useIdleChrome } from "./lightbox/useIdleChrome";
import { useLightboxKeys } from "./lightbox/useLightboxKeys";
import { useLightboxNav } from "./lightbox/useLightboxNav";
import { useModalLock } from "./lightbox/useModalLock";
import { usePressOrigin } from "./lightbox/usePressOrigin";
import { srcSetOf } from "./lightbox/srcset";
import { usePreloadNeighbours } from "./lightbox/usePreloadNeighbours";
import { useSwipe } from "./lightbox/useSwipe";
import { NavZone } from "./lightbox/NavZone";
import { BTN } from "./lightbox/styles";
import type { GalleryPhoto } from "./types";

export type LightboxProps = {
  photos: readonly GalleryPhoto[];
  index: number;
  t: TFunction;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onFavorite?: (id: string) => void;
  onDownload?: (id: string) => void;
  isFavorite?: (id: string) => boolean;
  /** Proofing: block "Save image" (overlay above the photo, no context menu). */
  protect?: boolean;
};

export function Lightbox(props: LightboxProps) {
  const { photos, onClose } = props;
  const empty = photos.length === 0;
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (empty) closeRef.current();
  }, [empty]);
  if (empty) return null;
  const index = Math.min(
    Math.max(0, Math.trunc(props.index) || 0),
    photos.length - 1,
  );
  return <LightboxView {...props} index={index} />;
}

const withRetry = (url: string, n: number) =>
  n === 0 ? url : `${url}${url.includes("?") ? "&" : "?"}r=${n}`;

function LightboxView({
  photos,
  index,
  t,
  onClose,
  onIndexChange,
  onFavorite,
  onDownload,
  isFavorite,
  protect = false,
}: LightboxProps) {
  const imgUrl = useImgUrl();
  const srcSet = srcSetOf(imgUrl);
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  // Retry counter is per photo: a retry on one photo must not affect others.
  const [retryState, setRetryState] = useState<{ id: string; n: number }>({
    id: "",
    n: 0,
  });
  const photo = photos[index];
  // Events from images of other photos (out-of-order loads) are ignored.
  const currentId = useRef(photo.id);
  useEffect(() => {
    currentId.current = photo.id;
  });
  const total = photos.length;
  const { hasPrev, hasNext, prev, next, close } = useLightboxNav({
    index,
    total,
    onClose,
    onIndexChange,
  });
  useModalLock(closeRef);
  useLightboxKeys(dialogRef, close, prev, next);

  usePreloadNeighbours(photos, index, imgUrl);

  const { visible, wake, onKeyWake, onFocusWake } = useIdleChrome(dialogRef);
  const { notePress, onStageClick } = usePressOrigin(stageRef, onClose);
  const { dragX, handlers: swipe } = useSwipe({
    hasPrev,
    hasNext,
    prev,
    next,
    onClose,
  });

  // An error belongs to one photo; navigating away forgets it so coming back
  // tries again.
  if (failedId !== null && failedId !== photo.id) setFailedId(null);

  const favorite = isFavorite?.(photo.id) ?? false;
  const loaded = loadedId === photo.id;
  const failed = failedId === photo.id;
  // Keep the last loaded photo on screen while the new one loads.
  const behind =
    !loaded && !failed && loadedId !== null
      ? photos.find((p) => p.id === loadedId)
      : undefined;
  const chrome = `transition-opacity duration-slow ease-out-soft ${
    visible ? "opacity-100" : "pointer-events-none opacity-0"
  }`;

  const retry = retryState.id === photo.id ? retryState.n : 0;
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={t("grid.photo", { n: index + 1 })}
      data-theme="oscuro"
      data-controls={visible ? "visible" : "hidden"}
      onPointerDown={(e) => {
        notePress(e);
        swipe.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        wake(e);
        swipe.onPointerMove(e);
      }}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onMouseDown={notePress}
      onClickCapture={swipe.onClickCapture}
      onFocus={onFocusWake}
      onKeyDown={onKeyWake}
      className={`on-dark fixed inset-0 touch-pan-y touch-pinch-zoom bg-night text-white ${visible ? "" : "cursor-none"}${protect ? " img-protect" : ""}`}
      style={{ zIndex: "var(--z-lightbox)" }}
      onContextMenu={protect ? (e) => e.preventDefault() : undefined}
    >
      <div
        ref={stageRef}
        data-testid="lightbox-stage"
        className="absolute inset-0 grid place-items-center select-none"
        onClick={onStageClick}
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
              onClick={() => {
                setFailedId(null);
                setRetryState((r) => ({
                  id: photo.id,
                  n: r.id === photo.id ? r.n + 1 : 1,
                }));
              }}
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
                sizes="(min-width: 768px) 92vw, 100vw"
                alt=""
                aria-hidden="true"
                draggable={false}
                className="pointer-events-none col-start-1 row-start-1 block h-[80vh] w-screen object-contain opacity-100 md:h-[86vh] md:w-[92vw]"
              />
            )}
            <img
              key={`${photo.id}:${retry}`}
              ref={(img) => {
                if (
                  img?.complete &&
                  img.naturalWidth > 0 &&
                  currentId.current === photo.id
                )
                  setLoadedId(photo.id);
              }}
              data-testid="lightbox-img"
              src={withRetry(imgUrl(photo.id, "view-sm", photo.v), retry)}
              srcSet={retry ? undefined : srcSet(photo.id, photo.v)}
              sizes="(min-width: 768px) 92vw, 100vw"
              alt={t("grid.photo", { n: index + 1 })}
              draggable={false}
              onLoad={() => {
                if (currentId.current === photo.id) setLoadedId(photo.id);
              }}
              onError={() => {
                if (currentId.current === photo.id) setFailedId(photo.id);
              }}
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

      <div
        className={`absolute inset-x-0 top-0 flex items-center justify-between px-4 py-2 ${chrome}`}
      >
        <span className="text-micro-label text-white/70">
          {t("lightbox.counter", { n: index + 1, total })}
        </span>
        <div className="flex">
          {onFavorite && (
            <button
              type="button"
              className={BTN}
              aria-label={t(favorite ? "favorites.remove" : "favorites.add")}
              aria-pressed={favorite}
              onClick={() => onFavorite(photo.id)}
            >
              {favorite ? <HeartFilled /> : <Heart />}
            </button>
          )}
          {onDownload && (
            <button
              type="button"
              className={BTN}
              aria-label={t("download.title")}
              onClick={() => onDownload(photo.id)}
            >
              <Download />
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            className={BTN}
            aria-label={t("lightbox.close")}
            onClick={onClose}
          >
            <Close />
          </button>
        </div>
      </div>

      <NavZone
        side="left"
        label={t("lightbox.previous")}
        enabled={hasPrev}
        onClick={prev}
      >
        <ChevronLeft className={`size-12 ${chrome}`} />
      </NavZone>
      <NavZone
        side="right"
        label={t("lightbox.next")}
        enabled={hasNext}
        onClick={next}
      >
        <ChevronRight className={`size-12 ${chrome}`} />
      </NavZone>
    </div>
  );
}
