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

type ProgressViewProps = {
  t: TFunction;
  phase: BulkPhase;
  progress: BulkProgress;
  status: "done" | "cancelled";
  fallback: Fallback;
  confirming: boolean;
  setConfirming: (v: boolean) => void;
  onAbort: () => void;
  onClose: () => void;
  noRef: RefObject<HTMLButtonElement | null>;
  cancelRef: RefObject<HTMLButtonElement | null>;
  closeBtnRef: RefObject<HTMLButtonElement | null>;
};
type Fallback = { key: TKey; answer: (ok: boolean) => void } | null;

const PRIMARY = "text-micro-label bg-ink text-paper h-11 flex-1 uppercase";
const OUTLINE = "text-micro-label border-ink h-11 flex-1 border uppercase";

/** Running (progress, fallback question, cancel confirm) and done screens of a bulk download. */
export function BulkProgressView(props: ProgressViewProps) {
  const { t, phase, progress, status, onClose, closeBtnRef } = props;
  return (
    <div className="flex flex-col gap-4">
      {phase === "running" ? (
        <RunningView {...props} />
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

function RunningView({
  t,
  progress,
  fallback,
  confirming,
  setConfirming,
  onAbort,
  noRef,
  cancelRef,
}: ProgressViewProps) {
  const pct = progress.total
    ? Math.min(100, (progress.done / progress.total) * 100)
    : 0;
  return (
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
      {fallback && <FallbackQuestion t={t} fallback={fallback} />}
      {confirming ? (
        <ConfirmCancel
          t={t}
          noRef={noRef}
          onYes={() => {
            setConfirming(false);
            onAbort();
            fallback?.answer(false);
          }}
          onNo={() => setConfirming(false)}
        />
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
  );
}

/** "This is big, continue?" while a download waits on the visitor's answer. */
function FallbackQuestion({
  t,
  fallback,
}: {
  t: TFunction;
  fallback: NonNullable<Fallback>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p role="note" className="text-small text-grey-700">
        {t(fallback.key)}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => fallback.answer(true)}
          className={PRIMARY}
        >
          {t("download.continue")}
        </button>
        <button
          type="button"
          onClick={() => fallback.answer(false)}
          className={OUTLINE}
        >
          {t("download.cancel")}
        </button>
      </div>
    </div>
  );
}

function ConfirmCancel({
  t,
  noRef,
  onYes,
  onNo,
}: {
  t: TFunction;
  noRef: RefObject<HTMLButtonElement | null>;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label={t("download.confirmCancel")}
      className="flex flex-col gap-2"
    >
      <p className="text-small">{t("download.confirmCancel")}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onYes} className={PRIMARY}>
          {t("download.yes")}
        </button>
        <button type="button" ref={noRef} onClick={onNo} className={OUTLINE}>
          {t("download.no")}
        </button>
      </div>
    </div>
  );
}

type ChooseViewProps = {
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
};

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
}: ChooseViewProps) {
  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col">
        <legend className="text-micro-label text-grey-600 mb-1 uppercase">
          {t("download.scope")}
        </legend>
        {scopes.map((s) => (
          <Radio
            key={s.label}
            name="dl-scope"
            checked={scope === s.key}
            label={s.label}
            onChange={() => setScope(s.key)}
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-col">
        <legend className="text-micro-label text-grey-600 mb-1 uppercase">
          {t("download.size")}
        </legend>
        {sizes.map((s) => (
          <Radio
            key={t(s.key)}
            name="dl-size"
            checked={variant === s.variant}
            label={t(s.key)}
            onChange={() => setVariant(s.variant)}
          />
        ))}
      </fieldset>
      <ChooseNotes
        t={t}
        count={count}
        variant={variant}
        warning={warning}
        error={error}
      />
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

function Radio({
  name,
  checked,
  label,
  onChange,
}: {
  name: string;
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label
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
}

/** Count and size estimate, plus the iOS / large-download warning and the error. */
function ChooseNotes({
  t,
  count,
  variant,
  warning,
  error,
}: Pick<ChooseViewProps, "t" | "count" | "variant" | "warning" | "error">) {
  return (
    <>
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
    </>
  );
}
