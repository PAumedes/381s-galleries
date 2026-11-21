import { useEffect, useRef, useState, type FormEvent } from "react";
import { restoreFocus, trapTab, useLatest } from "./dialog-keys";

import type { TFunction } from "../i18n/t";
import { EMAIL_RE } from "../lib/email";
import { Close } from "./icons";

export type GateResult = "ok" | "invalid" | "error";

export type EmailGateProps = {
  t: TFunction;
  onSubmit: (email: string, name: string) => Promise<GateResult>;
  onClose: () => void;
};

/** Minimal modal asking for an email (+ optional name) before saving favourites. */
export function EmailGate({ t, onSubmit, onClose }: EmailGateProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const closeRef = useLatest(onClose);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    emailRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === "Tab") {
        trapTab(e, dialogRef.current);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreFocus(opener);
    };
  }, [closeRef]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError(t("gate.invalid"));
      return;
    }
    setError(null);
    setBusy(true);
    let result: GateResult;
    try {
      result = await onSubmit(trimmed, name.trim());
    } catch {
      result = "error";
    }
    setBusy(false);
    if (result === "invalid") setError(t("gate.invalid"));
    else if (result === "error") setError(t("gate.error"));
  };

  return (
    <div
      className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/50 px-4"

      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("gate.title")}
        className="bg-paper text-ink relative flex w-full max-w-sm flex-col gap-5 p-8"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t("lightbox.close")}
          className="text-grey-600 hover:text-ink absolute top-1 right-1 flex size-11 items-center justify-center"
        >
          <Close className="size-5" aria-hidden="true" />
        </button>
        <h2 className="text-micro-label pr-8 uppercase">{t("gate.title")}</h2>
        <p className="text-small text-grey-600">{t("gate.reason")}</p>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <label className="sr-only" htmlFor="gate-email">
            {t("gate.placeholder")}
          </label>
          <input
            ref={emailRef}
            id="gate-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("gate.placeholder")}
            aria-invalid={error ? true : undefined}
            className="text-body border-grey-300 focus:border-ink h-11 border-b bg-transparent px-1"
          />
          <label className="sr-only" htmlFor="gate-name">
            {t("gate.name")}
          </label>
          <input
            id="gate-name"
            type="text"
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("gate.name")}
            className="text-body border-grey-300 focus:border-ink h-11 border-b bg-transparent px-1"
          />
          {error && (
            <p role="alert" className="text-small text-grey-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="text-micro-label bg-ink text-paper duration-base ease-out-soft hover:bg-grey-800 h-11 uppercase transition-colors disabled:opacity-60"
          >
            {t("gate.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
