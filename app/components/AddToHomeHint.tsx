import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";

import { useT } from "../i18n/use-t";
import { Close, Share } from "./icons";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
};

type W = Window & { __a2hs?: InstallEvent };

const key = (slug: string) => `a2hs:${slug}`;
const read = (slug: string) => {
  try {
    return localStorage.getItem(key(slug)) !== null;
  } catch {
    return false;
  }
};
const write = (slug: string) => {
  try {
    localStorage.setItem(key(slug), "1");
  } catch {
    /* storage unavailable: the hint may reappear, nothing else */
  }
};

const mq = (q: string) =>
  typeof window.matchMedia === "function" && window.matchMedia(q).matches;

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return (
    ios &&
    /Safari\//.test(ua) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//.test(ua)
  );
}

const noopSubscribe = () => () => {};

function environment(slug: string): "no" | "ios" | "other" {
  const standalone =
    mq("(display-mode: standalone)") ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!mq("(pointer: coarse)") || standalone || read(slug)) return "no";
  return isIosSafari() ? "ios" : "other";
}

/**
 * "Add to home screen" note: mobile only, never when already installed, shown
 * once per gallery after the visitor has scrolled into the grid.
 * Android/Chrome gets a button that fires the captured install prompt; iOS
 * Safari gets the manual Share instructions; other browsers get nothing.
 */
export function AddToHomeHint({
  slug,
  gridRef,
}: {
  slug: string;
  gridRef: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  // "no" on the server and for desktop / installed / already-dismissed.
  const env = useSyncExternalStore(
    noopSubscribe,
    () => environment(slug),
    () => "no" as const,
  );
  const eligible = env !== "no";
  const ios = env === "ios";
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [inGrid, setInGrid] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!eligible) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    const onEarly = () => {
      const ev = (window as W).__a2hs;
      if (ev) setInstall(ev);
    };
    window.addEventListener("a2hs", onEarly);
    // Already fired before hydration: pick it up asynchronously.
    const t = setTimeout(onEarly, 0);
    const onInstalled = () => setDone(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("a2hs", onEarly);
      clearTimeout(t);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [eligible]);

  useEffect(() => {
    if (!eligible || inGrid) return;
    const check = () => {
      const top = gridRef.current?.getBoundingClientRect().top;
      if (top !== undefined && top <= window.innerHeight * 0.5) setInGrid(true);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, [eligible, inGrid, gridRef]);

  const kind = install ? "android" : ios ? "ios" : null;
  const visible = eligible && inGrid && !done && kind !== null;

  const close = useCallback(() => {
    write(slug);
    setDone(true);
  }, [slug]);

  const accept = useCallback(async () => {
    const ev = install;
    close();
    try {
      await ev?.prompt();
    } catch {
      /* prompt already used or blocked */
    }
  }, [install, close]);

  if (!visible) return null;
  return (
    <div
      role="status"
      className="bg-ink text-paper fixed inset-x-0 bottom-0 z-(--z-toast) flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 min-[28rem]:flex-nowrap pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      {kind === "ios" ? (
        <p className="text-body flex min-w-0 flex-1 items-center gap-2">
          <Share className="size-6 shrink-0" aria-hidden="true" />
          {t("pwa.ios")}
        </p>
      ) : (
        <>
          <p className="text-body min-w-0 basis-full min-[28rem]:basis-0 min-[28rem]:flex-1">{t("pwa.androidText")}</p>
          <button
            type="button"
            onClick={accept}
            className="motion-safe:transition-opacity min-h-12 min-w-0 basis-0 grow border border-current px-3 text-sm font-medium tracking-micro max-[22rem]:tracking-wider uppercase min-[28rem]:shrink-0 min-[28rem]:basis-auto min-[28rem]:grow-0 hover:opacity-80"
          >
            {t("pwa.install")}
          </button>
        </>
      )}
      <button
        type="button"
        onClick={close}
        aria-label={t("pwa.dismiss")}
        className="ml-auto flex size-12 shrink-0 items-center justify-center"
      >
        <Close className="size-6" aria-hidden="true" />
      </button>
    </div>
  );
}
