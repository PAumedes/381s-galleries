import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
} from "./icons";
import { imgUrl, type GalleryPhoto } from "./types";

const SWIPE_DISTANCE = 50;
const SWIPE_VELOCITY = 0.5; // px per ms
const SWIPE_MIN_FAST = 20;
const CLOSE_DISTANCE = 80;
const IDLE_MS = 2500;

export type LightboxProps = {
  photos: readonly GalleryPhoto[];
  index: number;
  t: TFunction;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onFavorite?: (id: string) => void;
  onDownload?: (id: string) => void;
  isFavorite?: (id: string) => boolean;
};

const srcSet = (id: string) =>
  `${imgUrl(id, "view-sm")} 1200w, ${imgUrl(id, "view-lg")} 2048w`;

const BTN =
  "flex size-11 items-center justify-center text-white/70 transition-colors duration-base ease-out-soft hover:text-white disabled:pointer-events-none disabled:opacity-25";

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
}: LightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
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

  const photo = photos[index];
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
      if (e.key === "Escape") {
        e.preventDefault();
        latest.current.onClose();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
        if (e.key === "ArrowLeft") prev();
        else next();
      } else if (e.key === "Tab") {
        const nodes = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
        );
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

  // Preload neighbours.
  useEffect(() => {
    for (const p of [photos[index + 1], photos[index - 1]]) {
      if (!p) continue;
      const img = new Image();
      img.sizes = "92vw";
      img.srcset = srcSet(p.id);
      img.src = imgUrl(p.id, "view-sm");
    }
  }, [photos, index]);

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
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
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

  const favorite = isFavorite?.(photo.id) ?? false;
  const loaded = loadedId === photo.id;
  const failed = failedId === photo.id;
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
      data-theme="dark"
      data-controls={visible ? "visible" : "hidden"}
      onPointerMove={wake}
      onFocus={onFocusWake}
      onKeyDown={onKeyWake}
      className={`on-dark fixed inset-0 bg-night text-white ${visible ? "" : "cursor-none"}`}
      style={{ zIndex: "var(--z-lightbox)" }}
    >
      <div
        data-testid="lightbox-stage"
        className="absolute inset-0 flex touch-pan-y touch-pinch-zoom items-center justify-center select-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={(e) => endDrag(e, true)}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
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
              className="min-h-11 px-3 underline hover:text-white"
              onClick={() => {
                setFailedId(null);
                setRetryState((r) => ({
                  id: photo.id,
                  n: r.id === photo.id ? r.n + 1 : 1,
                }));
              }}
            >
              {t("lightbox.retry")}
            </button>
          </div>
        ) : (
          <img
            key={`${photo.id}:${retry}`}
            ref={(img) => {
              if (img?.complete && img.naturalWidth > 0) setLoadedId(photo.id);
            }}
            data-testid="lightbox-img"
            src={withRetry(imgUrl(photo.id, "view-sm"), retry)}
            srcSet={retry ? undefined : srcSet(photo.id)}
            sizes="92vw"
            alt={t("grid.photo", { n: index + 1 })}
            draggable={false}
            onLoad={() => setLoadedId(photo.id)}
            onError={() => setFailedId(photo.id)}
            className={`block max-h-[86vh] max-w-[92vw] object-contain ${
              dragX === 0
                ? "transition-[opacity,transform] duration-slow ease-out-soft"
                : "transition-opacity duration-slow"
            } motion-reduce:transition-none ${loaded ? "opacity-100" : "opacity-0"}`}
            style={{ transform: dragX ? `translateX(${dragX}px)` : undefined }}
          />
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

      <button
        type="button"
        className={`${BTN} absolute top-1/2 left-2 -translate-y-1/2 pointer-coarse:hidden ${chrome}`}
        aria-label={t("lightbox.previous")}
        disabled={!hasPrev}
        onClick={prev}
      >
        <ChevronLeft />
      </button>
      <button
        type="button"
        className={`${BTN} absolute top-1/2 right-2 -translate-y-1/2 pointer-coarse:hidden ${chrome}`}
        aria-label={t("lightbox.next")}
        disabled={!hasNext}
        onClick={next}
      >
        <ChevronRight />
      </button>
    </div>
  );
}
