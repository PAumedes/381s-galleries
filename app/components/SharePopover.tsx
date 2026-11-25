import { useId, useRef, useState } from "react";
import type { RefObject } from "react";
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

/** Opens the native share sheet; true when it handled the share (not a failure), guarding against double taps. */
async function shareNatively(
  pending: { current: boolean },
  data: Parameters<typeof nativeShare>[0],
) {
  pending.current = true;
  let r: Awaited<ReturnType<typeof nativeShare>>;
  try {
    r = await nativeShare(data);
  } finally {
    pending.current = false;
  }
  return r !== "failed";
}

/**
 * The share flow: the button tries the native share sheet, and falls back to
 * the popover (open) when there is none or it failed for a reason other than
 * the user cancelling; "copy" copies the canonical URL.
 */
function useShareFlow(
  title: string,
  onCopied: () => void,
  urlRef: RefObject<HTMLInputElement | null>,
  btnRef: RefObject<HTMLButtonElement | null>,
  boxRef: RefObject<HTMLDivElement | null>,
) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const pending = useRef(false);
  const root = useRouteLoaderData("root") as { origin?: string } | undefined;
  const t = useT();
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
    // Checked before awaiting: without a share sheet the popover opens in this tick.
    if (
      typeof navigator.share === "function" &&
      (await shareNatively(pending, { title, text: message, url: link }))
    )
      return;
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
  return {
    open,
    url,
    copyFailed,
    message,
    onClick,
    copy,
    close,
    dismiss: () => setOpen(false),
  };
}

/** Shown when the clipboard is denied: the link in a field to copy by hand. */
function ManualCopy({
  url,
  urlRef,
}: {
  url: string;
  urlRef: RefObject<HTMLInputElement | null>;
}) {
  const t = useT();
  return (
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
  );
}

/** The popover: WhatsApp link, copy link (with a manual-copy field when the clipboard is denied) and close. */
function SharePanelBox({
  id,
  share,
  urlRef,
  btnRef,
  boxRef,
}: {
  id: string;
  share: ReturnType<typeof useShareFlow>;
  urlRef: RefObject<HTMLInputElement | null>;
  btnRef: RefObject<HTMLButtonElement | null>;
  boxRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  const { url, copyFailed } = share;
  return (
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
          share.dismiss();
      }}
      className="bg-paper text-ink border-grey-300 absolute right-0 top-full z-(--z-toast) mt-1 flex w-56 flex-col border py-1 shadow-lg"
    >
      <a
        href={whatsappHref(share.message, url)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={share.dismiss}
        className={item}
      >
        {t("gallery.shareWhatsapp")}
      </a>
      <button type="button" onClick={share.copy} className={item}>
        {t("gallery.shareCopy")}
      </button>
      {copyFailed && <ManualCopy url={url} urlRef={urlRef} />}
      <button type="button" onClick={share.close} className={item}>
        {t("gallery.shareClose")}
      </button>
    </div>
  );
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
  const urlRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const share = useShareFlow(title, onCopied, urlRef, btnRef, boxRef);
  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={share.onClick}
        aria-label={t("gallery.share")}
        aria-haspopup="dialog"
        aria-expanded={share.open}
        aria-controls={share.open ? id : undefined}
        className="text-grey-600 hover:text-ink flex size-11 items-center justify-center"
      >
        <Share className="size-5" aria-hidden="true" />
      </button>
      {share.open && (
        <SharePanelBox
          id={id}
          share={share}
          urlRef={urlRef}
          btnRef={btnRef}
          boxRef={boxRef}
        />
      )}
    </div>
  );
}
