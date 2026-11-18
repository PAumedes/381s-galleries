import { useEffect, useRef, useState } from "react";

const DELAY_MS = 350;
const MARGIN = 8;
const MAX_W = 448;
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

export interface LookState {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
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
  const clamp = (v: number, max: number) =>
    Math.max(MARGIN, Math.min(v, max - MARGIN));
  let left = r.right + MARGIN;
  if (left + width > vw - MARGIN) left = r.left - MARGIN - width;
  if (left < MARGIN)
    left = clamp((r.left + r.right) / 2 - width / 2, vw - width + MARGIN);
  const top = clamp((r.top + r.bottom) / 2 - height / 2, vh - height + MARGIN);
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

  function stop() {
    window.clearTimeout(timer.current);
    cleanup.current?.();
    cleanup.current = null;
    setLook(null);
  }
  function start(id: string, el: HTMLElement) {
    stop();
    if (
      typeof window.matchMedia !== "function" ||
      !window.matchMedia(FINE_POINTER).matches
    )
      return;
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
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      cleanup.current?.();
    },
    [],
  );
  return { look, start, stop };
}

export function QuickLook({ look }: { look: LookState | null }) {
  return look ? <Box key={look.id} look={look} /> : null;
}

function Box({ look }: { look: LookState }) {
  const [loaded, setLoaded] = useState(false);
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
        className={`size-full object-contain transition-opacity duration-base motion-reduce:transition-none ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
