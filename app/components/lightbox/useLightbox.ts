import type { RefObject } from "react";

import type { LightboxProps } from "./types";
import { useImgUrl } from "../img-url";
import { useAnimatedClose } from "./useAnimatedClose";
import { useIdleChrome } from "./useIdleChrome";
import { useLightboxKeys } from "./useLightboxKeys";
import { useLightboxNav } from "./useLightboxNav";
import { useModalLock } from "./useModalLock";
import { usePressOrigin } from "./usePressOrigin";
import { usePreloadNeighbours } from "./usePreloadNeighbours";
import { useSwipe } from "./useSwipe";

/** The fade of the controls while idle. */
const chromeClass = (visible: boolean) =>
  `transition-opacity duration-slow ease-out-soft ${
    visible ? "opacity-100" : "pointer-events-none opacity-0"
  }`;

/** The elements the lightbox hooks act on; created by the view (refs stay out of the returned bag). */
export type LightboxRefs = {
  dialogRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  closeRef: RefObject<HTMLButtonElement | null>;
};

type Swipe = ReturnType<typeof useSwipe>["handlers"];
type Idle = ReturnType<typeof useIdleChrome>;
type PointerEv = React.PointerEvent<HTMLDivElement>;

/** Pointer / focus / key handlers of the dialog root: press origin, swipe and idle-chrome wake-ups combined. */
function dialogEventsOf(
  notePress: (e: React.MouseEvent | React.PointerEvent) => void,
  swipe: Swipe,
  idle: Idle,
) {
  return {
    onPointerDown: (e: PointerEv) => {
      notePress(e);
      swipe.onPointerDown(e);
    },
    onPointerMove: (e: PointerEv) => {
      idle.wake(e);
      swipe.onPointerMove(e);
    },
    onPointerUp: swipe.onPointerUp,
    onPointerCancel: swipe.onPointerCancel,
    onMouseDown: notePress,
    onClickCapture: swipe.onClickCapture,
    onFocus: idle.onFocusWake,
    onKeyDown: idle.onKeyWake,
  };
}

/**
 * Everything the lightbox dialog needs to render: navigation, close
 * animation, keyboard, idle chrome, press origin, swipe and the touch /
 * chrome class names. The view itself is markup only.
 */
export function useLightbox(
  props: LightboxProps,
  { dialogRef, stageRef, closeRef }: LightboxRefs,
) {
  const { photos, index, onClose, onIndexChange } = props;
  const imgUrl = useImgUrl();
  const total = photos.length;
  const { close, closeFrom, closing } = useAnimatedClose(dialogRef, onClose);
  const { hasPrev, hasNext, prev, next } = useLightboxNav({
    index,
    total,
    onClose: close,
    onIndexChange,
    blocked: closing,
  });
  useModalLock(closeRef);
  useLightboxKeys(dialogRef, close, prev, next);

  const isReady = usePreloadNeighbours(photos, index, imgUrl);

  const idle = useIdleChrome(dialogRef);
  const { notePress, onStageClick } = usePressOrigin(stageRef, close, {
    prev,
    next,
  });
  const {
    dragX,
    dragY,
    handlers: swipe,
  } = useSwipe({ hasPrev, hasNext, prev, next, onClose: closeFrom });

  return {
    total,
    close,
    hasPrev,
    hasNext,
    prev,
    next,
    isReady,
    visible: idle.visible,
    notePress,
    onStageClick,
    dragX,
    dragY,
    chrome: chromeClass(idle.visible),
    dialogEvents: dialogEventsOf(notePress, swipe, idle),
  };
}
