import { useEffect, useMemo, useRef, useState } from "react";

import type { TFunction, TKey } from "../i18n/t";
import {
  bulkWarning,
  currentPicker,
  downloadBulk,
  downloadSingle,
  estimateBytes,
  formatBytes,
  type BulkProgress,
  type BulkScope,
  type DlVariant,
} from "../lib/download-client";
import { EmailRequiredError } from "./use-visitor";
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

const ROW =
  "text-small flex min-h-11 w-full items-center px-1 text-left transition-colors duration-base ease-out-soft";

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

type Phase = "choose" | "running" | "done";

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
  const [phase, setPhase] = useState<Phase>("choose");
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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  useEffect(() => () => ctl.current?.abort(), []);
  // Keep focus on the primary control of the current phase.
  useEffect(() => {
    if (phase === "running") cancelRef.current?.focus();
    else if (phase === "done") closeBtnRef.current?.focus();
    else if (moved.current) startRef.current?.focus();
    moved.current = true;
  }, [phase]);
  const askedConfirm = useRef(false);
  useEffect(() => {
    if (confirming) {
      askedConfirm.current = true;
      noRef.current?.focus();
    } else if (askedConfirm.current) {
      askedConfirm.current = false;
      cancelRef.current?.focus();
    }
  }, [confirming]);
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
    const pct = progress.total
      ? Math.min(100, (progress.done / progress.total) * 100)
      : 0;
    return (
      <div className="flex flex-col gap-4">
        {phase === "running" ? (
          <>
            <div
              role="progressbar"
              aria-label={t("download.title")}
              aria-valuemin={0}
              aria-valuenow={progress.done}
              aria-valuemax={progress.total}
              className="bg-grey-200 h-px w-full"
            >
              <div
                className="bg-ink h-px transition-[width] duration-base ease-out-soft motion-reduce:transition-none"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-micro-label text-grey-600">
              {t("download.progress", {
                done: progress.done,
                total: progress.total,
              })}
            </p>
            {progress.waiting !== undefined && (
              <p role="status" className="text-small text-grey-700">
                {t("download.waiting", { n: progress.waiting })}
              </p>
            )}
            {fallback && (
              <div className="flex flex-col gap-2">
                <p role="note" className="text-small text-grey-700">
                  {t(fallback.key)}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fallback.answer(true)}
                    className="text-micro-label bg-ink text-paper h-11 flex-1 uppercase"
                  >
                    {t("download.continue")}
                  </button>
                  <button
                    type="button"
                    onClick={() => fallback.answer(false)}
                    className="text-micro-label border-ink h-11 flex-1 border uppercase"
                  >
                    {t("download.cancel")}
                  </button>
                </div>
              </div>
            )}
            {confirming ? (
              <div
                role="alertdialog"
                aria-label={t("download.confirmCancel")}
                className="flex flex-col gap-2"
              >
                <p className="text-small">{t("download.confirmCancel")}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(false);
                      ctl.current?.abort();
                      fallback?.answer(false);
                    }}
                    className="text-micro-label bg-ink text-paper h-11 flex-1 uppercase"
                  >
                    {t("download.yes")}
                  </button>
                  <button
                    type="button"
                    ref={noRef}
                    onClick={() => setConfirming(false)}
                    className="text-micro-label border-ink h-11 flex-1 border uppercase"
                  >
                    {t("download.no")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                ref={cancelRef}
                onClick={() => ctl.current?.abort()}
                className="text-micro-label border-ink hover:bg-grey-50 h-11 border uppercase transition-colors duration-base ease-out-soft"
              >
                {t("download.cancel")}
              </button>
            )}
          </>
        ) : (
          <>
            <p role="status" className="text-small">
              {t(
                status === "cancelled" ? "download.cancelled" : "download.done",
              )}
            </p>
            {progress.failed.length > 0 && (
              <p className="text-small text-grey-600">
                {t("download.failed", {
                  count: progress.failed.length,
                  n: progress.failed.length,
                })}
              </p>
            )}
            <button
              type="button"
              ref={closeBtnRef}
              onClick={onClose}
              className="text-micro-label bg-ink text-paper hover:bg-grey-800 h-11 uppercase transition-colors duration-base ease-out-soft"
            >
              {t("lightbox.close")}
            </button>
          </>
        )}
      </div>
    );
  }

  const radio = (
    name: string,
    checked: boolean,
    label: string,
    onChange: () => void,
  ) => (
    <label
      key={label}
      className={`${ROW} has-[:checked]:text-ink text-grey-600 hover:text-ink has-[:focus-visible]:outline-2 cursor-pointer gap-3`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 border ${checked ? "bg-ink border-ink" : "border-grey-400"}`}
      />
      {label}
    </label>
  );

  return (
    <div className="flex flex-col gap-5">
      {
        <fieldset className="flex flex-col">
          <legend className="text-micro-label text-grey-600 mb-1 uppercase">
            {t("download.scope")}
          </legend>
          {scopes.map((s) =>
            radio("dl-scope", scope === s.key, s.label, () => setScope(s.key)),
          )}
        </fieldset>
      }
      <fieldset className="flex flex-col">
        <legend className="text-micro-label text-grey-600 mb-1 uppercase">
          {t("download.size")}
        </legend>
        {sizes.map((s) =>
          radio("dl-size", variant === s.variant, t(s.key), () =>
            setVariant(s.variant),
          ),
        )}
      </fieldset>
      <p className="text-small text-grey-600">
        {t("download.count", { count, n: count })} ·{" "}
        {t("download.approx", {
          size: formatBytes(estimateBytes(count, variant)),
        })}
      </p>
      {warning && (
        <p role="note" className="text-small text-grey-700">
          {t(warning === "ios" ? "download.warnIos" : "download.warnLarge")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-small text-grey-600">
          {t("download.error")}
        </p>
      )}
      <button
        type="button"
        ref={startRef}
        disabled={count === 0 || phase !== "choose"}
        onClick={() => void start().catch(() => setError(true))}
        className="text-micro-label bg-ink text-paper hover:bg-grey-800 h-11 uppercase transition-colors duration-base ease-out-soft disabled:opacity-60"
      >
        {t("download.start")}
      </button>
    </div>
  );
}
