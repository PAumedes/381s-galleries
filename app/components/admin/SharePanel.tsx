import { useId, useState } from "react";

import { downloadBlob, qrPngBlob } from "../../lib/qr";
import { QrCode } from "./QrCode";

const btn =
  "text-micro uppercase border border-ink px-4 py-2 disabled:opacity-40";

export function SharePanel({
  url,
  slug,
  status,
  hasPin,
  cardHref,
}: {
  url: string;
  slug: string;
  status: "draft" | "published" | "archived";
  hasPin: boolean;
  cardHref?: string;
}) {
  const id = useId();
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState(false);

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
          Enlace público
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
            Copiar enlace
          </button>
        </div>
        <p role="status" className="text-small text-grey-700 min-h-5">
          {copied === "ok" && "Enlace copiado"}
          {copied === "fail" && "No se pudo copiar: seleccioná el enlace."}
        </p>
      </div>
      {status !== "published" && (
        <p className="text-small text-grey-700">
          La galería no es visible hasta publicarla
        </p>
      )}
      {hasPin && (
        <p className="text-small text-grey-700">
          Con PIN — compartilo por separado
        </p>
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
          Descargar QR (SVG)
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
          Descargar QR (PNG 1024px)
        </button>
      </div>
      {err && (
        <p role="alert" className="text-small text-ink font-medium">
          No se pudo generar el PNG.
        </p>
      )}
      {cardHref && (
        <a
          href={cardHref}
          target="_blank"
          rel="noreferrer"
          className={`${btn} self-start`}
        >
          Tarjeta imprimible (A6)
        </a>
      )}
    </div>
  );
}
