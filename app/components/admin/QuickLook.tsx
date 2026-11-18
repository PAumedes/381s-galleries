import { useEffect, useRef, useState } from "react";

const DELAY_MS = 350;
const MARGIN = 8;
const MAX_W = 448;
const FOCUS_AFTER_POINTER_MS = 100;
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

export interface LookState {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

function canHover(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(FINE_POINTER).matches
  );
}

/** A 4:3 box beside the tile, always inside the viewport. */
export function placeLook(
  id: string,
  r: { left: number; right: number; top: number; bottom: number },
  vw: number,
  vh: number,
): LookState {
  const width = Math.max(0, Math.min(MAX_W, vw - 2 * MARGIN));
  const height = Math.max(
    0,
    Math.min(Math.round((width * 3) / 4), vh - 2 * MARGIN),
  );
  const clamp = (v: number, max: number) => Math.max(MARGIN, Math.min(v, max));
  let left = r.right + MARGIN;
  if (left + width > vw - MARGIN) left = r.left - MARGIN - width;
  if (left < MARGIN)
    left = clamp((r.left + r.right) / 2 - width / 2, vw - width - MARGIN);
  const top = clamp((r.top + r.bottom) / 2 - height / 2, vh - height - MARGIN);
  return { id, left, top, width, height };
}

/**
 * Hover/focus preview of a whole picture. One shared popover, nothing loaded
 * until the delay passes; pointer-capable devices only. Any scroll, drag,
 * Escape or leaving cancels it.
 */
export function useQuickLook() {
  const [look, setLook] = useState<LookState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const cleanup = useRef<(() => void) | null>(null);
  const lastDown = useRef(-Infinity);
  const quietUntil = useRef(-Infinity);

  function stop() {
    window.clearTimeout(timer.current);
    cleanup.current?.();
    cleanup.current = null;
    setLook(null);
  }
  function start(id: string, el: HTMLElement) {
    stop();
    if (!canHover()) return;
    const cancel = (ev: Event) => {
      if (ev.type === "keydown" && (ev as KeyboardEvent).key !== "Escape")
        return;
      stop();
    };
    const events = ["keydown", "scroll", "dragstart", "pointerdown", "wheel"];
    for (const e of events) document.addEventListener(e, cancel, true);
    window.addEventListener("scroll", cancel, true);
    cleanup.current = () => {
      for (const e of events) document.removeEventListener(e, cancel, true);
      window.removeEventListener("scroll", cancel, true);
    };
    timer.current = window.setTimeout(() => {
      setLook(
        placeLook(id, el.getBoundingClientRect(), innerWidth, innerHeight),
      );
    }, DELAY_MS);
  }
  /** Mouse/pen hover only: touch (iPad with a mouse, touch laptops) never previews. */
  function hover(id: string, el: HTMLElement, pointerType?: string) {
    if (pointerType && pointerType !== "mouse" && pointerType !== "pen") return;
    start(id, el);
  }
  /** Keyboard focus only: not the focus that follows a click or a focus restore. */
  function focus(id: string, el: HTMLElement) {
    const now = Date.now();
    if (now - lastDown.current < FOCUS_AFTER_POINTER_MS) return;
    if (now < quietUntil.current) return;
    start(id, el);
  }
  const pointerDown = () => {
    lastDown.current = Date.now();
  };
  /** Ignore focus events for a moment (e.g. the viewer returning focus). */
  const quiet = (ms = 300) => {
    quietUntil.current = Date.now() + ms;
  };
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      cleanup.current?.();
    },
    [],
  );
  return { look, hover, focus, stop, pointerDown, quiet };
}

export function QuickLook({ look }: { look: LookState | null }) {
  return look ? <Box key={look.id} look={look} /> : null;
}

function Box({ look }: { look: LookState }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div
      data-quick-look=""
      aria-hidden="true"
      style={{
        left: look.left,
        top: look.top,
        width: look.width,
        height: look.height,
      }}
      className="bg-grey-100 border-grey-300 pointer-events-none fixed z-50 border shadow-lg"
    >
      <img
        src={`/admin/img/${look.id}/view-sm`}
        alt=""
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`size-full object-contain transition-opacity duration-base motion-reduce:transition-none ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
