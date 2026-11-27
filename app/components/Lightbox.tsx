import { useEffect, useRef } from "react";

import type { TFunction } from "../i18n/t";
import { ChevronLeft, ChevronRight } from "./icons";
import { pullBackdrop } from "./lightbox/motion";
import { PHONE_DISC } from "./lightbox/styles";
import type { LightboxProps } from "./lightbox/types";
import { useLightbox } from "./lightbox/useLightbox";
import { useZoomed } from "./lightbox/useZoomed";
import { ApproveButton } from "./lightbox/ApproveButton";
import { NavZone } from "./lightbox/NavZone";
import { PhotoStage } from "./lightbox/PhotoStage";
import { SwipeHint } from "./lightbox/SwipeHint";
import { TopBar } from "./lightbox/TopBar";
import { VersionTools } from "./lightbox/VersionTools";

export type { LightboxProps };

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

/** The dim layer behind the photo; it fades as the photo is pulled down. */
function Backdrop({ dragY }: { dragY: number }) {
  return (
    <div
      data-lb-backdrop
      aria-hidden="true"
      className="absolute inset-0 bg-night"
      style={{
        opacity: dragY ? pullBackdrop(dragY, window.innerHeight) : undefined,
      }}
    />
  );
}

/** The previous / next click zones with their chevrons (hidden while the chrome is idle). */
function NavZones({
  t,
  chrome,
  hasPrev,
  hasNext,
  prev,
  next,
}: {
  t: TFunction;
  chrome: string;
  hasPrev: boolean;
  hasNext: boolean;
  prev: () => void;
  next: () => void;
}) {
  return (
    <>
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
    </>
  );
}

/**
 * Pinch-zoom only keeps vertical swipes (close) ours; panning a zoomed photo
 * needs the browser's pan, so it is allowed only while zoomed. (Kept here: the
 * real-Chrome touch test reads these classes from this file.)
 */
function useTouchClass() {
  return useZoomed()
    ? "touch-pan-x touch-pan-y touch-pinch-zoom"
    : "touch-pinch-zoom";
}

function LightboxView(props: LightboxProps) {
  const { photos, index, t, protect = false } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lb = useLightbox(props, { dialogRef, stageRef, closeRef });
  const touch = useTouchClass();
  const { visible, dragX, dragY, chrome } = lb;
  const photo = photos[index];
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={t("grid.photo", { n: index + 1 })}
      data-theme="oscuro"
      data-controls={visible ? "visible" : "hidden"}
      {...lb.dialogEvents}
      className={`on-dark fixed inset-0 ${touch} text-white ${visible ? "" : "cursor-none"}${protect ? " img-protect" : ""}`}
      style={{ zIndex: "var(--z-lightbox)" }}
      onContextMenu={protect ? (e) => e.preventDefault() : undefined}
    >
      <Backdrop dragY={dragY} />
      <PhotoStage
        stageRef={stageRef}
        t={t}
        photos={photos}
        photo={photo}
        isReady={lb.isReady}
        index={index}
        dragX={dragX}
        dragY={dragY}
        protect={protect}
        onClick={lb.onStageClick}
        onDownload={
          props.originalDownload === false ? undefined : props.onDownload
        }
      />
      <TopBar
        t={t}
        chrome={chrome}
        index={index}
        total={lb.total}
        photoId={photo.id}
        favorite={props.isFavorite?.(photo.id) ?? false}
        closeRef={closeRef}
        onClose={lb.close}
        onFavorite={props.onFavorite}
        onDownload={props.onDownload}
      />
      <VersionTools key={photo.id} t={t} photo={photo} chrome={chrome} />
      {props.approvals?.enabled && (
        <ApproveButton
          key={photo.id}
          t={t}
          photo={photo}
          chrome={chrome}
          approvals={props.approvals}
        />
      )}
      <SwipeHint t={t} hasPrev={lb.hasPrev} hasNext={lb.hasNext} />
      <NavZones
        t={t}
        chrome={chrome}
        hasPrev={lb.hasPrev}
        hasNext={lb.hasNext}
        prev={lb.prev}
        next={lb.next}
      />
    </div>
  );
}
