import { useEffect, useState } from "react";

import { useT } from "../../i18n/use-t";
import { qrSvg } from "../../lib/qr";

/** Renders the QR for `url` as inline SVG (client-side only). */
export function QrCode({
  url,
  className,
  onSvg,
}: {
  url: string;
  className?: string;
  onSvg?: (svg: string) => void;
}) {
  const t = useT();
  // Result is keyed by url so a stale QR is never shown for a new url.
  const [res, setRes] = useState<{
    url: string;
    svg: string;
    failed: boolean;
  } | null>(null);
  const cur = res?.url === url ? res : null;
  const svg = cur?.svg ?? "";
  const failed = cur?.failed ?? false;
  useEffect(() => {
    let live = true;
    onSvg?.("");
    qrSvg(url).then(
      (s) => {
        if (!live) return;
        setRes({ url, svg: s, failed: false });
        onSvg?.(s);
      },
      () => {
        if (!live) return;
        setRes({ url, svg: "", failed: true });
        onSvg?.("");
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  const common = {
    "data-testid": "qr",
    role: "img",
    "aria-label": t("admin.qr.label", { url }),
    className,
  };
  if (failed) {
    return (
      <div {...common}>
        <p role="alert" className="text-small p-2">
          {t("admin.qr.failed")}
        </p>
      </div>
    );
  }
  return <div {...common} dangerouslySetInnerHTML={{ __html: svg }} />;
}
