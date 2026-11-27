import { useId, useState } from "react";

import { useT } from "../../../i18n/use-t";
import { useIsClient } from "../../../lib/use-is-client";
import { WIZ_BTN, WIZ_INPUT } from "./ui";

/**
 * A link in a read-only field (select it by hand without JavaScript) with a
 * "copy" button that appears once the page is live.
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const t = useT();
  const id = useId();
  const live = useIsClient();
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-base font-semibold">
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={WIZ_INPUT}
        />
        {live && (
          <button type="button" onClick={copy} className={WIZ_BTN}>
            {t("admin.share.copy")}
          </button>
        )}
      </div>
      <p role="status" className="text-base">
        {copied === "ok" && t("admin.share.copied")}
        {copied === "fail" && t("admin.share.copyFailed")}
      </p>
    </div>
  );
}
