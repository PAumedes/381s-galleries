import type { GalleryStatus } from "../../lib/constants";
import { useId, useRef, useState, useSyncExternalStore } from "react";

import { useT } from "../../i18n/use-t";
import { downloadBlob, qrPngBlob } from "../../lib/qr";
import { canNativeShare, nativeShare, whatsappHref } from "../../lib/share";
import { QrCode } from "./QrCode";

const btn =
  "text-micro uppercase border border-ink px-4 py-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function SharePanel({
  url,
  slug,
  title,
  status,
  hasPin,
  cardHref,
}: {
  url: string;
  slug: string;
  title?: string;
  status: GalleryStatus;
  hasPin: boolean;
  cardHref?: string;
}) {
  const t = useT();
  const published = status === "published";
  const id = useId();
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const sharing = useRef(false);
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState(false);
  const native = useSyncExternalStore(
    () => () => {},
    canNativeShare,
    () => false,
  );
  // Never include the PIN: it is shared separately.
  const message = t("admin.share.message", { title: title ?? slug });

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied(null), 2500);
  }

  return (
    <div className="flex flex-col gap-3">
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
        <div className="flex flex-wrap gap-2 pt-1">
          {native && (
            <button
              type="button"
              className={btn}
              disabled={!published}
              onClick={async () => {
                if (sharing.current) return;
                sharing.current = true;
                try {
                  await nativeShare({
                    title: title ?? slug,
                    text: message,
                    url,
                  });
                } finally {
                  sharing.current = false;
                }
              }}
            >
              {t("admin.share.native")}
            </button>
          )}
          {published ? (
            <a
              href={whatsappHref(message, url)}
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
        <p role="status" className="text-small text-grey-700 min-h-5">
          {copied === "ok" && t("admin.share.copied")}
          {copied === "fail" && t("admin.share.copyFailed")}
        </p>
      </div>
      {status !== "published" && (
        <p className="text-small text-grey-700">
          {t("admin.share.notVisible")}
        </p>
      )}
      {hasPin && (
        <p className="text-small text-grey-700">{t("admin.share.pinned")}</p>
      )}
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
