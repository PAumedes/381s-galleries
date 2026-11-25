import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { useT } from "../../i18n/use-t";
import type { PreviewDevice } from "../../lib/preview-device";

/**
 * Virtual viewports the real page is laid out in, then scaled down. "cover"
 * = just the first screen (the cover); "page" = a scrollable page (cover,
 * then the grid).
 */
export const VIEWPORTS = {
  cover: {
    desktop: { w: 1280, h: 720, ratio: "16 / 9" },
    mobile: { w: 390, h: 823, ratio: "9 / 19" },
  },
  page: {
    desktop: { w: 1280, h: 800, ratio: "16 / 10" },
    mobile: { w: 390, h: 844, ratio: "390 / 844" },
  },
} as const;

/** Scale (frame width / virtual viewport width) that makes the page fit its frame. */
function useFitScale(viewportWidth: number) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setScale(el.clientWidth / viewportWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewportWidth]);
  return { boxRef, scale };
}

/**
 * The device frame (browser bar on desktop, phone bezel on mobile) around a
 * virtual viewport of `vp` pixels, scaled down to the frame's width.
 */
export function PreviewFrame({
  device,
  vp,
  scrollable,
  viewportRef,
  children,
}: {
  device: PreviewDevice;
  vp: { w: number; h: number; ratio: string };
  /** A scrollable page (focusable, labelled) rather than just the cover. */
  scrollable: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const t = useT();
  const { boxRef, scale } = useFitScale(vp.w);
  return (
    <div
      className={
        device === "mobile"
          ? "border-grey-900 mx-auto w-full max-w-[17.5rem] overflow-hidden rounded-[1.75rem] border-[6px]"
          : "border-grey-300 w-full overflow-hidden border"
      }
    >
      {device === "desktop" && (
        <div
          aria-hidden="true"
          className="border-grey-200 bg-grey-100 flex h-5 items-center gap-1 border-b px-2"
        >
          <span className="bg-grey-300 size-1.5 rounded-full" />
          <span className="bg-grey-300 size-1.5 rounded-full" />
          <span className="bg-grey-300 size-1.5 rounded-full" />
        </div>
      )}
      <div
        ref={boxRef}
        data-frame={device}
        style={{ aspectRatio: vp.ratio }}
        className="relative w-full overflow-hidden"
      >
        <div
          ref={viewportRef}
          data-viewport=""
          tabIndex={scrollable ? 0 : undefined}
          aria-label={scrollable ? t("admin.preview.scroll") : undefined}
          style={{
            width: `${vp.w}px`,
            height: `${vp.h}px`,
            transform: `scale(${scale})`,
          }}
          className={`absolute top-0 left-0 origin-top-left overflow-x-hidden ${scrollable ? "overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "overflow-hidden"}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
