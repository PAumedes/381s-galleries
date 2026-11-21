import type { RefObject } from "react";

import type { TFunction, TKey } from "../i18n/t";
import {
  estimateBytes,
  formatBytes,
  type BulkProgress,
  type BulkScope,
  type DlVariant,
} from "../lib/download-client";

export const ROW =
  "text-small flex min-h-11 w-full items-center px-1 text-left transition-colors duration-base ease-out-soft";

export type BulkPhase = "choose" | "running" | "done";

/** Running (progress, fallback question, cancel confirm) and done screens of a bulk download. */
export function BulkProgressView({
  t,
  phase,
  progress,
  status,
  fallback,
  confirming,
  setConfirming,
  onAbort,
  onClose,
  noRef,
  cancelRef,
  closeBtnRef,
}: {
  t: TFunction;
  phase: BulkPhase;
  progress: BulkProgress;
  status: "done" | "cancelled";
  fallback: { key: TKey; answer: (ok: boolean) => void } | null;
  confirming: boolean;
  setConfirming: (v: boolean) => void;
  onAbort: () => void;
  onClose: () => void;
  noRef: RefObject<HTMLButtonElement | null>;
  cancelRef: RefObject<HTMLButtonElement | null>;
  closeBtnRef: RefObject<HTMLButtonElement | null>;
}) {
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
                    onAbort();
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
              onClick={onAbort}
              className="text-micro-label border-ink hover:bg-grey-50 h-11 border uppercase transition-colors duration-base ease-out-soft"
            >
              {t("download.cancel")}
            </button>
          )}
        </>
      ) : (
        <>
          <p role="status" className="text-small">
            {t(status === "cancelled" ? "download.cancelled" : "download.done")}
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

/** Scope and size pickers, count and warnings before a bulk download starts. */
export function BulkChooseView({
  t,
  scopes,
  scope,
  setScope,
  sizes,
  variant,
  setVariant,
  count,
  warning,
  error,
  startRef,
  disabled,
  onStart,
}: {
  t: TFunction;
  scopes: readonly { key: BulkScope; label: string }[];
  scope: BulkScope;
  setScope: (s: BulkScope) => void;
  sizes: readonly { variant: DlVariant; key: TKey }[];
  variant: DlVariant;
  setVariant: (v: DlVariant) => void;
  count: number;
  warning: "ios" | "large" | null | undefined | false;
  error: boolean;
  startRef: RefObject<HTMLButtonElement | null>;
  disabled: boolean;
  onStart: () => void;
}) {
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
        disabled={disabled}
        onClick={onStart}
        className="text-micro-label bg-ink text-paper hover:bg-grey-800 h-11 uppercase transition-colors duration-base ease-out-soft disabled:opacity-60"
      >
        {t("download.start")}
      </button>
    </div>
  );
}
