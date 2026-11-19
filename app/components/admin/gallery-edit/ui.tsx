import { useId } from "react";

import type { GalleryActionResult } from "../../../lib/server/admin-galleries";

export const btn =
  "text-micro uppercase border border-ink min-h-tap px-4 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:min-h-10";
export const btnPrimary = `${btn} bg-ink text-paper`;
export const inputCls =
  "border-grey-300 bg-white w-full border px-3 py-2 text-body aria-invalid:border-ink aria-invalid:border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-grey-200 flex flex-col gap-3 border-t pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-micro text-grey-700 uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function Feedback({
  data,
  intent,
}: {
  data: GalleryActionResult | undefined;
  intent: string;
}) {
  if (!data || data.intent !== intent) return null;
  if (!data.ok)
    return (
      <p role="alert" className="border-ink border p-3 text-small">
        {data.error}
      </p>
    );
  return data.message ? (
    <p className="text-small text-grey-700">{data.message}</p>
  ) : null;
}

/** Label + control + inline error/hint wiring (aria-invalid, aria-describedby). */
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (p: {
    id: string;
    "aria-invalid"?: true;
    "aria-describedby"?: string;
  }) => React.ReactNode;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = [error && errId, hint && hintId]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small">
        {label}
      </label>
      {children({
        id,
        ...(error ? { "aria-invalid": true as const } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      })}
      {hint && (
        <p id={hintId} className="text-small text-grey-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-small text-ink font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

export function Check({
  name,
  label,
  checked,
  disabled,
  describedBy,
}: {
  name: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        className="size-6 md:size-4"
      />
      <label
        htmlFor={id}
        className="text-small flex min-h-tap flex-1 items-center md:min-h-0"
      >
        {label}
      </label>
    </div>
  );
}
