import { useEffect, useReducer, useState } from "react";

import type { TFunction } from "../../i18n/t";
import { useImgUrl } from "../img-url";
import type { GalleryPhoto } from "../types";
import { BTN } from "./styles";
import { CompareFrame, type CompareMode } from "./CompareFrame";
import type { ComparePair } from "./compare-math";

type Props = {
  t: TFunction;
  photo: GalleryPhoto;
  pair: ComparePair;
  /** Escape or the cluster's button: leave the comparison. */
  onClose: () => void;
};

/** Where the two previews are: nothing yet, each one in, or one failed. */
type Loads = { count: number; failed: boolean };
type LoadAction = "load" | "error" | "reset";
const loadReducer = (s: Loads, a: LoadAction): Loads =>
  a === "load"
    ? { ...s, count: s.count + 1 }
    : a === "error"
      ? { ...s, failed: true }
      : { count: 0, failed: false };

/** While the comparison is open Escape closes it first (before the history panel and the lightbox). */
function useEscapeFirst(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
}

const rtlNow = () =>
  getComputedStyle(document.documentElement).direction === "rtl";

/**
 * Clear of the top bar (4.5rem) and of the bottom-left cluster (compare
 * button + caption, up to 7.5rem + its 1rem margin), plus the device's safe
 * areas. Inline: the arbitrary values hold commas.
 */
const SAFE_PADDING = {
  paddingTop: "calc(4.5rem + env(safe-area-inset-top))",
  paddingBottom: "calc(9rem + env(safe-area-inset-bottom))",
  paddingLeft: "env(safe-area-inset-left)",
  paddingRight: "env(safe-area-inset-right)",
};

const TOGGLE =
  "min-h-11 min-w-11 cursor-pointer px-3 text-micro uppercase text-white/70 hover:text-white aria-pressed:bg-white/15 aria-pressed:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white";

/**
 * Compare the shown version with the previous one (T6.53e): two modes over the
 * two EXISTING view-sm previews (`/img/<id>/view-sm?ver=N`, the same URLs as
 * the history panel; nothing is generated). It fills the dialog under the top
 * bar and the bottom-left cluster, and leaves the side zones free.
 */
export function VersionCompare({ t, photo, pair, onClose }: Props) {
  const imgUrl = useImgUrl();
  const [mode, setMode] = useState<CompareMode>("flip");
  const [flipped, setFlipped] = useState(false);
  const [loads, load] = useReducer(loadReducer, { count: 0, failed: false });
  const [rtl] = useState(rtlNow);
  const [attempt, setAttempt] = useState(0);
  useEscapeFirst(onClose);
  useEffect(() => {
    document
      .querySelector<HTMLElement>('[data-testid="compare-flip"]')
      ?.focus();
  }, []);
  const side = ({ n, v }: { n: number; v?: string }) => ({
    n,
    src: imgUrl(photo.id, "view-sm", v, n),
  });
  const top = side(pair.shown);
  const under = side(pair.previous);
  const ready = loads.count >= 2 && !loads.failed;
  const showing = flipped ? under.n : top.n;
  const label = (n: number) => (
    <span
      key={n}
      data-testid={`compare-label-${n}`}
      aria-current={mode === "flip" && showing === n ? "true" : undefined}
      className={mode === "flip" && showing === n ? "text-white underline" : ""}
    >
      v{n}
    </span>
  );
  return (
    <div
      data-testid="compare"
      role="region"
      aria-label={t("compare.title")}
      className="absolute inset-0 flex flex-col items-center gap-2 bg-night"
      style={SAFE_PADDING}
    >
      <div className="flex items-center gap-3">
        <div role="group" aria-label={t("compare.modes")} className="flex">
          {(["flip", "slide"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`compare-mode-${m}`}
              aria-pressed={mode === m}
              className={TOGGLE}
              onClick={() => setMode(m)}
            >
              {t(`compare.${m}`)}
            </button>
          ))}
        </div>
        <span
          data-testid="compare-label"
          className="text-micro uppercase text-white/70 phone:text-[1rem]/6"
        >
          {label(top.n)} / {label(under.n)}
        </span>
        <span className="sr-only" aria-live="polite">
          {mode === "flip" ? t("compare.showing", { n: showing }) : ""}
        </span>
      </div>
      <div className="relative min-h-0 w-full flex-1 px-14 md:px-[15vw]">
        {loads.failed ? (
          <div
            role="alert"
            className="flex size-full flex-col items-center justify-center gap-3 text-center"
          >
            <span>{t("compare.error")}</span>
            <button
              type="button"
              className={`${BTN} w-auto min-w-11 px-3 text-micro uppercase underline`}
              onClick={() => {
                load("reset");
                setAttempt((a) => a + 1);
              }}
            >
              {t("lightbox.retry")}
            </button>
          </div>
        ) : (
          <>
            <CompareFrame
              key={attempt}
              t={t}
              mode={mode}
              top={top}
              under={under}
              flipped={flipped}
              onFlip={() => setFlipped((f) => !f)}
              rtl={rtl}
              ready={ready}
              onLoad={() => load("load")}
              onError={() => load("error")}
            />
            {!ready && (
              <p
                data-testid="compare-loading"
                role="status"
                className="absolute inset-0 flex items-center justify-center text-micro uppercase text-white/70"
              >
                {t("compare.loading")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
