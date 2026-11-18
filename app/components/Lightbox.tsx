import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";

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
import type { GalleryPhoto, ImgUrlFn } from "./types";

const SWIPE_DISTANCE = 50;
const SWIPE_VELOCITY = 0.5; // px per ms
const SWIPE_MIN_FAST = 20;
const CLOSE_DISTANCE = 80;
const IDLE_MS = 2500;
const DRAG_SLOP = 10;

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

const srcSetOf = (imgUrl: ImgUrlFn) => (id: string, v?: string) => {
  const sm = imgUrl(id, "view-sm", v);
  const lg = imgUrl(id, "view-lg", v);
  // The admin preview has no 2048 px variant: a single candidate then.
  return lg === sm ? `${sm} 1200w` : `${sm} 1200w, ${lg} 2048w`;
};

const FOCUS =
  "focus-visible:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white";

const BTN = `flex size-11 cursor-pointer items-center justify-center text-white/70 transition-colors duration-base ease-out-soft hover:text-white ${FOCUS} disabled:pointer-events-none disabled:opacity-25`;

// Previous/next: wide full-height side zones (15% of the width, 64px at
// least) that start below the top bar. Always clickable, even while the chrome
// is faded, and never pointer-events-none when disabled, so a click can't fall
// through to the backdrop and close the lightbox. On touch they become sr-only
// (still in the accessibility tree and the tab order) and phones swipe.
const NAV_ZONE = `absolute inset-y-16 flex w-[15vw] min-w-16 cursor-pointer items-center justify-center text-white/70 transition-colors duration-base ease-out-soft hover:bg-white/10 hover:text-white focus-visible:bg-white/10 ${FOCUS} disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent pointer-coarse:sr-only pointer-coarse:min-w-0`;

const TOP_BAR_PX = 64;
const SIDE_ZONE_FRACTION = 0.18; // slightly wider than the 15vw arrows

/**
 * Backdrop click rule: closes only on clearly empty backdrop, that is the
 * stage itself (not the photo, shield or a control), horizontally between the
 * two navigation zones and below the top bar. A miss near an arrow or the
 * controls does nothing instead of closing.
 */
const isEmptyBackdrop = (
  e: { target: EventTarget; currentTarget: EventTarget },
  x: number,
  y: number,
) => {
  if (e.target !== e.currentTarget) return false;
  const w = window.innerWidth;
  return (
    x > w * SIDE_ZONE_FRACTION &&
    x < w - w * SIDE_ZONE_FRACTION &&
    y > TOP_BAR_PX
  );
};

/** Real layout visibility (display:none on the node or an ancestor). */
const isRendered = (el: HTMLElement, root: HTMLElement) => {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (n === root) break;
  }
  return true;
};

const FOCUSABLE =
  "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

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

const isZoomed = () =>
  typeof window !== "undefined" && (window.visualViewport?.scale ?? 1) > 1.01;

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
  const [visible, setVisible] = useState(true);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [dragX, setDragX] = useState(0);
  const [failedId, setFailedId] = useState<string | null>(null);
  // Retry counter is per photo: a retry on one photo must not affect others.
  const [retryState, setRetryState] = useState<{ id: string; n: number }>({
    id: "",
    n: 0,
  });
  const lastKeyAt = useRef(0);
  const pointers = useRef(new Set<number>());
  const kbFocus = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const drag = useRef<{ x: number; y: number; t: number; id: number } | null>(
    null,
  );
  // A backdrop close needs the press to have started on empty backdrop too
  // (null: no press seen, e.g. a synthetic click).
  const pressOk = useRef<boolean | null>(null);
  // Set once a touch drag passes the slop; swallows the trailing click.
  const dragged = useRef(false);

  const photo = photos[index];
  // Events from images of other photos (out-of-order loads) are ignored.
  const currentId = useRef(photo.id);
  useEffect(() => {
    currentId.current = photo.id;
  });
  const total = photos.length;
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  // Keep the latest handlers reachable from stable listeners.
  const latest = useRef({ index, hasPrev, hasNext, onClose, onIndexChange });
  useEffect(() => {
    latest.current = { index, hasPrev, hasNext, onClose, onIndexChange };
  });

  const prev = useCallback(() => {
    const l = latest.current;
    if (l.hasPrev) l.onIndexChange(l.index - 1);
  }, []);
  const next = useCallback(() => {
    const l = latest.current;
    if (l.hasNext) l.onIndexChange(l.index + 1);
  }, []);

  // Focus in, restore on unmount; lock body scroll.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener && opener !== document.body && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  // Keyboard + focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A sheet/modal opened above the lightbox owns the keyboard.
      const other =
        (e.target as Element | null)?.closest?.('[role="dialog"]') ??
        document.activeElement?.closest?.('[role="dialog"]');
      if (other && other !== dialogRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        latest.current.onClose();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
        if (e.key === "ArrowLeft") prev();
        else next();
      } else if (e.key === "Tab") {
        const root = dialogRef.current;
        const nodes = Array.from(
          root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
        ).filter((n) => root && isRendered(n, root));
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (!dialogRef.current?.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prev, next]);

  // Preload neighbours. Stale ones (we navigated on) are cancelled so rapid
  // navigation never piles up requests: at most the two current neighbours.
  useEffect(() => {
    const inflight: HTMLImageElement[] = [];
    for (const p of [photos[index + 1], photos[index - 1]]) {
      if (!p) continue;
      const img = new Image();
      const done = () => {
        const at = inflight.indexOf(img);
        if (at >= 0) inflight.splice(at, 1);
      };
      img.onload = done;
      img.onerror = done;
      img.sizes = "(min-width: 768px) 92vw, 100vw";
      img.srcset = srcSetOf(imgUrl)(p.id, p.v);
      img.src = imgUrl(p.id, "view-sm", p.v);
      inflight.push(img);
    }
    return () => {
      for (const img of inflight) {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute?.("srcset");
        img.src = "";
      }
    };
  }, [photos, index, imgUrl]);

  // Auto-hide controls on pointer devices.
  useEffect(() => () => clearTimeout(idleTimer.current), []);
  const arm = () => {
    setVisible(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(function hide() {
      if (
        kbFocus.current &&
        dialogRef.current?.contains(document.activeElement)
      ) {
        idleTimer.current = setTimeout(hide, IDLE_MS);
        return;
      }
      // Focus must not linger on an invisible control; park it on the dialog.
      if (dialogRef.current?.contains(document.activeElement)) {
        dialogRef.current.focus();
      }
      setVisible(false);
    }, IDLE_MS);
  };
  const wake = (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse") return;
    kbFocus.current = false;
    arm();
  };
  const notePress = (e: ReactMouseEvent | ReactPointerEvent) => {
    pressOk.current = isEmptyBackdrop(
      { target: e.target, currentTarget: stageRef.current as EventTarget },
      e.clientX,
      e.clientY,
    );
  };
  const onKeyWake = () => {
    lastKeyAt.current = Date.now();
    kbFocus.current = true;
    arm();
  };
  // Focus only counts as keyboard focus right after a key press, so the
  // programmatic focus on mount or a tap doesn't pin the controls visible.
  const onFocusWake = () => {
    // Hidden controls are pointer-events:none, so focus landing while hidden
    // can only come from the keyboard.
    if (!visible || Date.now() - lastKeyAt.current < 1000) {
      kbFocus.current = true;
      arm();
    }
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragged.current = false;
    if (e.pointerType === "mouse") return;
    pointers.current.add(e.pointerId);
    if (pointers.current.size > 1 || isZoomed()) {
      drag.current = null;
      setDragX(0);
      return;
    }
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      id: e.pointerId,
    };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > DRAG_SLOP && !dragged.current) {
      // Capture only once it is a drag, so a plain tap still clicks its target.
      dragged.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      const blocked = (dx > 0 && !hasPrev) || (dx < 0 && !hasNext);
      setDragX(blocked ? dx / 4 : dx);
    }
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragX(0);
    if (cancelled || isZoomed()) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const dt = Math.max(1, Date.now() - d.t);
    if (Math.abs(dx) > Math.abs(dy)) {
      const fast =
        Math.abs(dx) >= SWIPE_MIN_FAST && Math.abs(dx) / dt > SWIPE_VELOCITY;
      if (Math.abs(dx) >= SWIPE_DISTANCE || fast) {
        if (dx < 0) next();
        else prev();
      }
    } else if (
      dy >= CLOSE_DISTANCE ||
      (dy >= SWIPE_MIN_FAST * 2 && dy / dt > SWIPE_VELOCITY)
    ) {
      onClose();
    }
  };

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
        onDown(e);
      }}
      onPointerMove={(e) => {
        wake(e);
        onMove(e);
      }}
      onPointerUp={endDrag}
      onPointerCancel={(e) => endDrag(e, true)}
      onMouseDown={notePress}
      onClickCapture={(e) => {
        // The click that ends a touch swipe must not hit what was under it.
        if (dragged.current) {
          dragged.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      }}
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
        onClick={(e) => {
          const pressed = pressOk.current;
          pressOk.current = null;
          if (pressed !== false && isEmptyBackdrop(e, e.clientX, e.clientY))
            onClose();
        }}
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

function NavZone({
  side,
  label,
  enabled,
  onClick,
  children,
}: {
  side: "left" | "right";
  label: string;
  enabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`${NAV_ZONE} ${side}-0`}
      aria-label={label}
      disabled={!enabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
