import type { Ref } from "react";

import type { TFunction } from "../../i18n/t";
import { Close, Download, Heart, HeartFilled } from "../icons";
import { BTN, ICON } from "./styles";

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

function FavoriteButton({
  t,
  favorite,
  onClick,
}: {
  t: TFunction;
  favorite: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={BTN}
      aria-label={t(favorite ? "favorites.remove" : "favorites.add")}
      aria-pressed={favorite}
      onClick={onClick}
    >
      {favorite ? <HeartFilled className={ICON} /> : <Heart className={ICON} />}
    </button>
  );
}

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
      className={`absolute inset-x-0 top-0 z-10 isolate flex items-center justify-between px-4 py-2 ${chrome}`}
    >
      {/* Phones: a soft dark fade so the bar reads over bright photos. */}
      <div
        data-lb-scrim
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 hidden h-28 bg-linear-to-b from-black/60 to-transparent phone:block"
      />
      <span className="text-micro uppercase phone:text-[1.125rem]/6 phone:tracking-wider text-white/70 phone:tabular-nums">
        {t("lightbox.counter", { n: index + 1, total })}
      </span>
      <div className="flex">
        {onFavorite && (
          <FavoriteButton
            t={t}
            favorite={favorite}
            onClick={() => onFavorite(photoId)}
          />
        )}
        {onDownload && (
          <button
            type="button"
            className={BTN}
            aria-label={t("download.title")}
            onClick={() => onDownload(photoId)}
          >
            <Download className={ICON} />
          </button>
        )}
        <button
          ref={closeRef}
          type="button"
          className={BTN}
          aria-label={t("lightbox.close")}
          onClick={onClose}
        >
          <Close className={ICON} />
        </button>
      </div>
    </div>
  );
}
