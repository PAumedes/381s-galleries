import { useId, useRef, useState } from "react";
import { useRouteLoaderData } from "react-router";

import { useT } from "../i18n/use-t";
import { nativeShare, whatsappHref } from "../lib/share";
import { Share } from "./icons";
import { usePopoverDismiss, useSelectWhen } from "./use-popover";

const item =
  "text-small text-ink hover:bg-grey-100 flex min-h-11 w-full items-center px-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink";

/** Canonical public URL: origin + path, never query, hash or session data. */
function canonicalUrl(origin?: string): string {
  return `${origin || window.location.origin}${window.location.pathname}`;
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
  const [copyFailed, setCopyFailed] = useState(false);
  const pending = useRef(false);
  const root = useRouteLoaderData("root") as { origin?: string } | undefined;
  const urlRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const message = t("gallery.shareMessage", { title });

  function close() {
    setOpen(false);
    btnRef.current?.focus();
  }

  async function onClick() {
    if (pending.current) return;
    if (open) return close();
    const link = canonicalUrl(root?.origin);
    setUrl(link);
    setCopyFailed(false);
    if (typeof navigator.share === "function") {
      pending.current = true;
      let r: Awaited<ReturnType<typeof nativeShare>>;
      try {
        r = await nativeShare({ title, text: message, url: link });
      } finally {
        pending.current = false;
      }
      if (r !== "failed") return;
    }
    setOpen(true);
  }

  usePopoverDismiss(open, boxRef, btnRef, close, () => setOpen(false));

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      onCopied();
      close();
    } catch {
      // Clipboard missing/denied: stay open so the user can copy by hand.
      setCopyFailed(true);
    }
  }

  useSelectWhen(urlRef, copyFailed);

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
          onBlur={(e) => {
            const to = e.relatedTarget as Node | null;
            if (
              to &&
              !boxRef.current?.contains(to) &&
              !btnRef.current?.contains(to)
            )
              setOpen(false);
          }}
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
          {copyFailed && (
            <>
              <p role="status" className="text-small px-4 py-2">
                {t("gallery.shareCopyFailed")}
              </p>
              <input
                ref={urlRef}
                readOnly
                value={url}
                aria-label={t("gallery.shareCopy")}
                onFocus={(e) => e.currentTarget.select()}
                className="border-grey-300 text-small mx-4 mb-2 border px-2 py-1"
              />
            </>
          )}
          <button type="button" onClick={close} className={item}>
            {t("gallery.shareClose")}
          </button>
        </div>
      )}
    </div>
  );
}
