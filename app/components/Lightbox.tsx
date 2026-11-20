import { useEffect, useRef } from "react";

import type { TFunction } from "../i18n/t";
import { ChevronLeft, ChevronRight } from "./icons";
import { useImgUrl } from "./img-url";
import { pullBackdrop } from "./lightbox/motion";
import { PHONE_DISC } from "./lightbox/styles";
import { useAnimatedClose } from "./lightbox/useAnimatedClose";
import { useIdleChrome } from "./lightbox/useIdleChrome";
import { useLightboxKeys } from "./lightbox/useLightboxKeys";
import { useLightboxNav } from "./lightbox/useLightboxNav";
import { useModalLock } from "./lightbox/useModalLock";
import { usePressOrigin } from "./lightbox/usePressOrigin";
import { usePreloadNeighbours } from "./lightbox/usePreloadNeighbours";
import { useSwipe } from "./lightbox/useSwipe";
import { useZoomed } from "./lightbox/useZoomed";
import { NavZone } from "./lightbox/NavZone";
import { PhotoStage } from "./lightbox/PhotoStage";
import { SwipeHint } from "./lightbox/SwipeHint";
import { TopBar } from "./lightbox/TopBar";
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const photo = photos[index];
  const total = photos.length;
  const { hasPrev, hasNext, prev, next, close } = useLightboxNav({
    index,
    total,
    onClose,
    onIndexChange,
  });
  useModalLock(closeRef);
  useLightboxKeys(dialogRef, close, prev, next);

  const isReady = usePreloadNeighbours(photos, index, imgUrl);

  const { visible, wake, onKeyWake, onFocusWake } = useIdleChrome(dialogRef);
  const closeFrom = useAnimatedClose(dialogRef, onClose);
  const { notePress, onStageClick } = usePressOrigin(stageRef, onClose, {
    prev,
    next,
  });
  const {
    dragX,
    dragY,
    handlers: swipe,
  } = useSwipe({
    hasPrev,
    hasNext,
    prev,
    next,
    onClose: closeFrom,
  });

  // Pinch-zoom only keeps vertical swipes (close) ours; panning a zoomed photo
  // needs the browser's pan, so it is allowed only while zoomed.
  const touch = useZoomed()
    ? "touch-pan-x touch-pan-y touch-pinch-zoom"
    : "touch-pinch-zoom";
  const favorite = isFavorite?.(photo.id) ?? false;
  const chrome = `transition-opacity duration-slow ease-out-soft ${
    visible ? "opacity-100" : "pointer-events-none opacity-0"
  }`;

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
      className={`on-dark fixed inset-0 ${touch} text-white ${visible ? "" : "cursor-none"}${protect ? " img-protect" : ""}`}
      style={{ zIndex: "var(--z-lightbox)" }}
      onContextMenu={protect ? (e) => e.preventDefault() : undefined}
    >
      <div
        data-lb-backdrop
        aria-hidden="true"
        className="absolute inset-0 bg-night"
        style={{
          opacity: dragY ? pullBackdrop(dragY, window.innerHeight) : undefined,
        }}
      />
      <PhotoStage
        stageRef={stageRef}
        t={t}
        photos={photos}
        photo={photo}
        isReady={isReady}
        index={index}
        dragX={dragX}
        dragY={dragY}
        protect={protect}
        onClick={onStageClick}
      />
      <TopBar
        t={t}
        chrome={chrome}
        index={index}
        total={total}
        photoId={photo.id}
        favorite={favorite}
        closeRef={closeRef}
        onClose={onClose}
        onFavorite={onFavorite}
        onDownload={onDownload}
      />

      <SwipeHint t={t} hasPrev={hasPrev} hasNext={hasNext} />
      <NavZone
        side="left"
        label={t("lightbox.previous")}
        enabled={hasPrev}
        onClick={prev}
      >
        <ChevronLeft className={`size-12 ${PHONE_DISC} ${chrome}`} />
      </NavZone>
      <NavZone
        side="right"
        label={t("lightbox.next")}
        enabled={hasNext}
        onClick={next}
      >
        <ChevronRight className={`size-12 ${PHONE_DISC} ${chrome}`} />
      </NavZone>
    </div>
  );
}
