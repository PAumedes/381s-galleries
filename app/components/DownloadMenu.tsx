import { useEffect, useMemo, useRef, useState } from "react";

import type { TFunction, TKey } from "../i18n/t";
import {
  bulkWarning,
  currentPicker,
  downloadBulk,
  downloadSingle,
  type BulkProgress,
  type BulkScope,
  type DlVariant,
} from "../lib/download-client";
import { EmailRequiredError } from "./use-visitor";
import { useBulkFocus } from "./use-bulk-focus";
import {
  BulkChooseView,
  BulkProgressView,
  ROW,
  type BulkPhase,
} from "./DownloadBulkViews";
import { Close } from "./icons";
import type { GalleryPhoto, OpenGallery } from "./types";

const FOCUSABLE = "button:not([disabled]), input:not([disabled])";
const SIZES: { variant: DlVariant; key: TKey }[] = [
  { variant: "highres", key: "download.highres" },
  { variant: "web", key: "download.web" },
  { variant: "ig", key: "download.ig" },
];

const allowed = (g: OpenGallery, v: DlVariant) =>
  v === "highres" ? g.allowHighres : v === "web" ? g.allowWeb : g.allowIg;
const hasVariant = (p: GalleryPhoto, v: DlVariant) =>
  v === "highres" || Boolean(p.variants?.[v]);

/** Sizes the gallery allows (optionally narrowed to what a photo has). */
export const enabledSizes = (g: OpenGallery, photo?: GalleryPhoto) =>
  SIZES.filter(
    (s) => allowed(g, s.variant) && (!photo || hasVariant(photo, s.variant)),
  );

export type DownloadMode =
  | { kind: "single"; photo: GalleryPhoto }
  | {
      kind: "bulk";
      photos: readonly GalleryPhoto[];
      /** The set tab currently shown (null when "all" or favourites). */
      activeSet: string | null;
      favoriteIds: ReadonlySet<string>;
    };

export type DownloadMenuProps = {
  gallery: OpenGallery;
  t: TFunction;
  mode: DownloadMode;
  /** Runs an action behind the email gate (`useVisitor.ensure`). */
  ensure: (action: () => void | Promise<void>) => Promise<void>;
  onClose: () => void;
  onError?: () => void;
};

export function DownloadMenu(props: DownloadMenuProps) {
  const { t, onClose } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const [confirming, setConfirming] = useState(false);
  // While a bulk run is going, closing asks first instead of aborting.
  const requestClose = () => {
    if (runningRef.current) setConfirming(true);
    else onClose();
  };
  const closeRef = useRef(requestClose);
  useEffect(() => {
    closeRef.current = requestClose;
  });
  const title = t(
    props.mode.kind === "single" ? "download.photo" : "download.title",
  );

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Another dialog (the email gate) on top owns the keyboard.
      const other =
        (e.target as Element | null)?.closest?.('[role="dialog"]') ??
        document.activeElement?.closest?.('[role="dialog"]');
      if (other && other !== dialogRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        // The sheet owns Escape: nothing underneath (the lightbox) may see it.
        e.stopPropagation();
        e.stopImmediatePropagation();
        closeRef.current();
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
    // Capture phase so we run before (and can shield) listeners underneath.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener && opener !== document.body && opener.isConnected)
        opener.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-(--z-sheet) flex items-end justify-center bg-black/50 sm:items-center sm:px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-paper text-ink relative flex max-h-dvh w-full flex-col gap-5 overflow-y-auto p-6 sm:w-[420px] sm:p-8"
      >
        <button
          type="button"
          onClick={requestClose}
          aria-label={t("lightbox.close")}
          className="text-grey-600 hover:text-ink absolute top-1 right-1 flex size-11 items-center justify-center"
        >
          <Close className="size-5" aria-hidden="true" />
        </button>
        <h2 className="text-micro-label pr-8 uppercase">{title}</h2>
        {props.mode.kind === "single" ? (
          <SingleBody {...props} photo={props.mode.photo} />
        ) : (
          <BulkBody
            {...props}
            mode={props.mode}
            runningRef={runningRef}
            confirming={confirming}
            setConfirming={setConfirming}
          />
        )}
      </div>
    </div>
  );
}

function SingleBody({
  gallery,
  t,
  ensure,
  onClose,
  onError,
  photo,
}: DownloadMenuProps & { photo: GalleryPhoto }) {
  const pick = (variant: DlVariant) => {
    onClose();
    ensure(() => downloadSingle(gallery.slug, photo.id, variant)).catch(() =>
      onError?.(),
    );
  };
  return (
    <ul className="flex flex-col">
      {enabledSizes(gallery, photo).map((s) => (
        <li
          key={s.variant}
          className="border-grey-200 border-t first:border-t-0"
        >
          <button
            type="button"
            onClick={() => pick(s.variant)}
            className={`${ROW} hover:bg-grey-50`}
          >
            {t(s.key)}
          </button>
        </li>
      ))}
    </ul>
  );
}

function BulkBody({
  gallery,
  t,
  ensure,
  onClose,
  mode,
  runningRef,
  confirming,
  setConfirming,
}: DownloadMenuProps & {
  mode: Extract<DownloadMode, { kind: "bulk" }>;
  runningRef: { current: boolean };
  confirming: boolean;
  setConfirming: (v: boolean) => void;
}) {
  const sizes = enabledSizes(gallery);
  const { photos, activeSet, favoriteIds } = mode;
  const [scope, setScope] = useState<BulkScope>("all");
  const [variant, setVariant] = useState<DlVariant>(
    sizes[0]?.variant ?? "highres",
  );
  const [phase, setPhase] = useState<BulkPhase>("choose");
  const [progress, setProgress] = useState<BulkProgress>({
    done: 0,
    total: 0,
    bytes: 0,
    failed: [],
  });
  const [status, setStatus] = useState<"done" | "cancelled">("done");
  const [error, setError] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const started = useRef(false);
  const live = useRef(false);
  // A yes/no question to the visitor while running (save dialog failed / large in-memory zip).
  const [fallback, setFallback] = useState<{
    key: TKey;
    answer: (ok: boolean) => void;
  } | null>(null);
  const { cancelRef, noRef, closeBtnRef, startRef } = useBulkFocus(
    phase,
    confirming,
  );
  useEffect(() => () => ctl.current?.abort(), []);
  useEffect(() => {
    runningRef.current = phase === "running";
  }, [phase, runningRef]);

  const scopes: { key: BulkScope; label: string }[] = [
    { key: "all", label: t("download.scopeAll") },
    ...(activeSet
      ? [
          {
            key: "set" as const,
            label: t("download.scopeSet", { set: activeSet }),
          },
        ]
      : []),
    ...(favoriteIds.size > 0
      ? [{ key: "favorites" as const, label: t("download.scopeFavorites") }]
      : []),
  ];

  const count = useMemo(
    () =>
      photos.filter(
        (p) =>
          hasVariant(p, variant) &&
          (scope === "all" ||
            (scope === "set" ? p.set === activeSet : favoriteIds.has(p.id))),
      ).length,
    [photos, variant, scope, activeSet, favoriteIds],
  );
  const warning = bulkWarning({
    count,
    variant,
    picker: Boolean(currentPicker()),
  });

  const ask = (key: TKey) =>
    new Promise<boolean>((resolve) =>
      setFallback({
        key,
        answer: (ok: boolean) => {
          setFallback(null);
          resolve(ok);
        },
      }),
    );

  const start = () => {
    if (started.current) return Promise.resolve();
    started.current = true;
    // `ensure` runs the action synchronously unless it opens the email gate;
    // only a direct click may open the save picker, so a gate-resumed action
    // does nothing and the visitor presses Download again.
    live.current = true;
    const p = ensure(async () => {
      if (!live.current) {
        started.current = false;
        return;
      }
      const c = new AbortController();
      ctl.current = c;
      setError(false);
      setProgress({ done: 0, total: count, bytes: 0, failed: [] });
      setPhase("running");
      try {
        const r = await downloadBulk({
          slug: gallery.slug,
          scope,
          ...(scope === "set" && activeSet ? { set: activeSet } : {}),
          variant,
          signal: c.signal,
          sets: new Map(photos.map((p) => [p.id, p.set])),
          onProgress: setProgress,
          confirmFallback: () => ask("download.pickerFailed"),
          ...(warning === "large"
            ? {}
            : { confirmLarge: () => ask("download.warnLarge") }),
        });
        setProgress({ ...r });
        setStatus(r.status);
        setPhase("done");
      } catch (err) {
        started.current = false;
        setPhase("choose");
        if (err instanceof EmailRequiredError) throw err;
        setError(true);
      }
    });
    live.current = false;
    return p;
  };

  if (phase !== "choose") {
    return (
      <BulkProgressView
        t={t}
        phase={phase}
        progress={progress}
        status={status}
        fallback={fallback}
        confirming={confirming}
        setConfirming={setConfirming}
        onAbort={() => ctl.current?.abort()}
        onClose={onClose}
        noRef={noRef}
        cancelRef={cancelRef}
        closeBtnRef={closeBtnRef}
      />
    );
  }

  return (
    <BulkChooseView
      t={t}
      scopes={scopes}
      scope={scope}
      setScope={setScope}
      sizes={sizes}
      variant={variant}
      setVariant={setVariant}
      count={count}
      warning={warning}
      error={error}
      startRef={startRef}
      disabled={count === 0 || phase !== "choose"}
      onStart={() => void start().catch(() => setError(true))}
    />
  );
}
