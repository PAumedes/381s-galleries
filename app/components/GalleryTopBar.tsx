import type { ReactNode } from "react";

import type { TKey } from "../i18n/t";
import { useT } from "../i18n/use-t";
import { Download, Heart, HeartFilled } from "./icons";
import { SharePopover } from "./SharePopover";

const iconBtn =
  "text-grey-600 hover:text-ink flex size-11 items-center justify-center";

/** Right side of the gallery top bar: download slot, bulk, favourites, share. */
export function TopBarActions({
  downloadSlot,
  showBulk,
  onBulk,
  favOn,
  hasFavs,
  onToggleFavs,
  shareTitle,
  onCopied,
}: {
  downloadSlot?: ReactNode;
  showBulk: boolean;
  onBulk: () => void;
  /** The favourites tab is the active one. */
  favOn: boolean;
  hasFavs: boolean;
  onToggleFavs: () => void;
  /** Null (admin preview) hides the share button. */
  shareTitle: string | null;
  onCopied: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center justify-self-end">
      {downloadSlot}
      {showBulk && (
        <button
          type="button"
          onClick={onBulk}
          aria-label={t("download.title")}
          className={iconBtn}
        >
          <Download className="size-5" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        onClick={onToggleFavs}
        aria-label={t("favorites.title")}
        aria-pressed={favOn}
        className={iconBtn}
      >
        {favOn || hasFavs ? (
          <HeartFilled className="size-5" aria-hidden="true" />
        ) : (
          <Heart className="size-5" aria-hidden="true" />
        )}
      </button>
      {shareTitle !== null && (
        <SharePopover title={shareTitle} onCopied={onCopied} />
      )}
    </div>
  );
}

/** The single bottom toast; remount it (new `key`) to replay. */
export function Toast({ messageKey }: { messageKey: TKey }) {
  const t = useT();
  return (
    <p
      role="status"
      className="text-micro-label bg-ink text-paper fixed bottom-6 left-1/2 z-(--z-toast) -translate-x-1/2 px-5 py-3 uppercase"
    >
      {t(messageKey)}
    </p>
  );
}
