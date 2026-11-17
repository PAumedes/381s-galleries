import { useEffect, useId, useRef, useState } from "react";

import { useT } from "../i18n/use-t";
import { nativeShare, whatsappHref } from "../lib/share";
import { Share } from "./icons";

const item =
  "text-small text-ink hover:bg-grey-100 flex min-h-11 w-full items-center px-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink";

/** Canonical public URL: origin + path, never query, hash or session data. */
function canonicalUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/**
 * Header share button. Uses the native share sheet when present; otherwise
 * (or if it fails for a reason other than the user cancelling) a small
 * popover with a WhatsApp link and "copy link".
 */
export function SharePopover({
  title,
  onCopied,
}: {
  title: string;
  onCopied: () => void;
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const message = t("gallery.shareMessage", { title });

  function close() {
    setOpen(false);
    btnRef.current?.focus();
  }

  async function onClick() {
    if (open) return close();
    const link = canonicalUrl();
    setUrl(link);
    if (typeof navigator.share === "function") {
      const r = await nativeShare({ title, text: message, url: link });
      if (r !== "failed") return;
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    boxRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!boxRef.current?.contains(n) && !btnRef.current?.contains(n))
        setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      onCopied();
    } catch {
      /* clipboard unavailable: nothing to confirm */
    }
    close();
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={onClick}
        aria-label={t("gallery.share")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="text-grey-600 hover:text-ink flex size-11 items-center justify-center"
      >
        <Share className="size-5" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={boxRef}
          id={id}
          role="dialog"
          aria-label={t("gallery.share")}
          className="bg-paper text-ink border-grey-300 absolute right-0 top-full z-(--z-toast) mt-1 flex w-56 flex-col border py-1 shadow-lg"
        >
          <a
            href={whatsappHref(message, url)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={item}
          >
            {t("gallery.shareWhatsapp")}
          </a>
          <button type="button" onClick={copy} className={item}>
            {t("gallery.shareCopy")}
          </button>
          <button type="button" onClick={close} className={item}>
            {t("gallery.shareClose")}
          </button>
        </div>
      )}
    </div>
  );
}
