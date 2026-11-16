import { useEffect, useRef, useState, type FormEvent } from "react";

import type { TFunction } from "../i18n/t";
import { Close } from "./icons";

export type GateResult = "ok" | "invalid" | "error";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FOCUSABLE = "button:not([disabled]), input:not([disabled])";

export type EmailGateProps = {
  t: TFunction;
  onSubmit: (email: string, name: string) => Promise<GateResult>;
  onClose: () => void;
};

/** Minimal modal asking for an email (+ optional name) before saving favourites. */
export function EmailGate({ t, onSubmit, onClose }: EmailGateProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
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
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && opener !== document.body && opener.isConnected)
        opener.focus();
    };
  }, []);

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
      className="fixed inset-0 flex items-center justify-center bg-black/50 px-4"
      style={{ zIndex: "var(--z-modal, 60)" }}
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
            className="text-body border-grey-300 focus:border-ink h-11 border-b bg-transparent px-1 outline-none"
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
            className="text-body border-grey-300 focus:border-ink h-11 border-b bg-transparent px-1 outline-none"
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
