import type { Ref } from "react";

import type { TFunction } from "../../i18n/t";
import { Close, Download, Heart, HeartFilled } from "../icons";
import { BTN } from "./styles";

type TopBarProps = {
  t: TFunction;
  /** Visibility classes shared with the side arrows. */
  chrome: string;
  index: number;
  total: number;
  photoId: string;
  favorite: boolean;
  closeRef: Ref<HTMLButtonElement>;
  onClose: () => void;
  onFavorite?: (id: string) => void;
  onDownload?: (id: string) => void;
};

/** Counter plus favourite / download (only when wired) and close. */
export function TopBar({
  t,
  chrome,
  index,
  total,
  photoId,
  favorite,
  closeRef,
  onClose,
  onFavorite,
  onDownload,
}: TopBarProps) {
  return (
    <div
      className={`absolute inset-x-0 top-0 flex items-center justify-between px-4 py-2 ${chrome}`}
    >
      <span className="text-micro-label text-white/70">
        {t("lightbox.counter", { n: index + 1, total })}
      </span>
      <div className="flex">
        {onFavorite && (
          <button
            type="button"
            className={BTN}
            aria-label={t(favorite ? "favorites.remove" : "favorites.add")}
            aria-pressed={favorite}
            onClick={() => onFavorite(photoId)}
          >
            {favorite ? <HeartFilled /> : <Heart />}
          </button>
        )}
        {onDownload && (
          <button
            type="button"
            className={BTN}
            aria-label={t("download.title")}
            onClick={() => onDownload(photoId)}
          >
            <Download />
          </button>
        )}
        <button
          ref={closeRef}
          type="button"
          className={BTN}
          aria-label={t("lightbox.close")}
          onClick={onClose}
        >
          <Close />
        </button>
      </div>
    </div>
  );
}
