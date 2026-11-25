import type { GalleryStatus } from "../../lib/constants";
import { useId, useRef, useState, useSyncExternalStore } from "react";

import { useT } from "../../i18n/use-t";
import { downloadBlob, qrPngBlob } from "../../lib/qr";
import { canNativeShare, nativeShare, whatsappHref } from "../../lib/share";
import { QrCode } from "./QrCode";

const btn =
  "text-micro uppercase border border-ink px-4 py-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

type SharePanelProps = {
  url: string;
  slug: string;
  title?: string;
  status: GalleryStatus;
  hasPin: boolean;
  cardHref?: string;
};

/** Native share (when the browser has it) and WhatsApp; both off until the gallery is published. */
function ShareTargets({
  published,
  showNative,
  onShare,
  whatsapp,
}: {
  published: boolean;
  showNative: boolean;
  onShare: () => void;
  whatsapp: string;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {showNative && (
        <button
          type="button"
          className={btn}
          disabled={!published}
          onClick={onShare}
        >
          {t("admin.share.native")}
        </button>
      )}
      {published ? (
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          data-tap
          className={btn}
        >
          {t("admin.share.whatsapp")}
        </a>
      ) : (
        <span aria-disabled="true" className={`${btn} opacity-40`}>
          {t("admin.share.whatsapp")}
        </span>
      )}
    </div>
  );
}

/** Copies `url` to the clipboard; `copied` shows the result for 2.5 seconds. */
function useCopyLink(url: string) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied(null), 2500);
  }
  return { copied, copy };
}

/** Link field, copy, native share (when available) and WhatsApp. */
function LinkShare({
  url,
  slug,
  title,
  published,
}: Pick<SharePanelProps, "url" | "slug" | "title"> & { published: boolean }) {
  const t = useT();
  const id = useId();
  const { copied, copy } = useCopyLink(url);
  const sharing = useRef(false);
  const native = useSyncExternalStore(
    () => () => {},
    canNativeShare,
    () => false,
  );
  // Never include the PIN: it is shared separately.
  const message = t("admin.share.message", { title: title ?? slug });

  async function share() {
    if (sharing.current) return;
    sharing.current = true;
    try {
      await nativeShare({ title: title ?? slug, text: message, url });
    } finally {
      sharing.current = false;
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small">
        {t("admin.share.link")}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="border-grey-300 bg-white w-full min-w-0 border px-3 py-2 text-body"
        />
        <button type="button" className={btn} onClick={copy}>
          {t("admin.share.copy")}
        </button>
      </div>
      <ShareTargets
        published={published}
        showNative={native}
        onShare={share}
        whatsapp={whatsappHref(message, url)}
      />
      <p role="status" className="text-small text-grey-700 min-h-5">
        {copied === "ok" && t("admin.share.copied")}
        {copied === "fail" && t("admin.share.copyFailed")}
      </p>
    </div>
  );
}

/** The QR code with its SVG and PNG downloads. */
function QrShare({ url, slug }: Pick<SharePanelProps, "url" | "slug">) {
  const t = useT();
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState(false);
  return (
    <>
      <QrCode
        url={url}
        onSvg={setSvg}
        className="size-48 border border-grey-200 [&>svg]:size-full"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btn}
          disabled={!svg}
          onClick={() =>
            downloadBlob(
              new Blob([svg], { type: "image/svg+xml" }),
              `${slug}-qr.svg`,
            )
          }
        >
          {t("admin.share.qrSvg")}
        </button>
        <button
          type="button"
          className={btn}
          disabled={!svg}
          onClick={async () => {
            setErr(false);
            try {
              downloadBlob(await qrPngBlob(url, 1024), `${slug}-qr.png`);
            } catch {
              setErr(true);
            }
          }}
        >
          {t("admin.share.qrPng")}
        </button>
      </div>
      {err && (
        <p role="alert" className="text-small text-ink font-medium">
          {t("admin.share.pngFailed")}
        </p>
      )}
    </>
  );
}

export function SharePanel({
  url,
  slug,
  title,
  status,
  hasPin,
  cardHref,
}: SharePanelProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <LinkShare
        url={url}
        slug={slug}
        title={title}
        published={status === "published"}
      />
      {status !== "published" && (
        <p className="text-small text-grey-700">
          {t("admin.share.notVisible")}
        </p>
      )}
      {hasPin && (
        <p className="text-small text-grey-700">{t("admin.share.pinned")}</p>
      )}
      <QrShare url={url} slug={slug} />
      {cardHref && (
        <a
          href={cardHref}
          target="_blank"
          rel="noreferrer"
          data-tap
          className={`${btn} self-start`}
        >
          {t("admin.share.card")}
        </a>
      )}
    </div>
  );
}
