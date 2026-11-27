import { useEffect, useId, useState, type ReactNode } from "react";

import { useFormat } from "../../i18n/use-format";
import type { TFunction } from "../../i18n/t";
import { studioParts } from "../../lib/studio-time";
import { useImgUrl } from "../img-url";
import type { GalleryPhoto, PhotoVersionInfo } from "../types";
import { BTN } from "./styles";

type Props = {
  t: TFunction;
  photo: GalleryPhoto;
  /** Visibility classes shared with the rest of the chrome. */
  chrome: string;
  /** The comparison (T6.53e) covers the stage: the panel waits under it, Escape goes to the comparison first. */
  comparing?: boolean;
  /** Extra control of the cluster, above the caption (the compare button). */
  action?: ReactNode;
};

/** Pointer events inside the panel belong to it, not to the swipe-to-close of the dialog. */
const keepHere = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * Versioned albums (T6.53c): which version the photo shows ("Versión 3 ·
 * Ronda 3") and, when it has more than one, a history of previews (v1..vN
 * with round and date). Previews only: nothing here downloads, and only the
 * shown (latest) version is downloadable from the lightbox's own button.
 */
export function VersionHistory({
  t,
  photo,
  chrome,
  comparing = false,
  action,
}: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const versions = photo.versions;
  // While the panel is open Escape closes it first, wherever the focus is: the
  // capture phase runs before the lightbox's own Escape (which closes it all).
  const panel = open && !comparing;
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [panel]);
  if (!photo.ver) return null;
  const shown = versions?.find((v) => v.n === photo.ver);
  return (
    <div
      data-testid="lightbox-versions"
      className={`absolute bottom-4 left-4 z-10 flex flex-col items-start gap-2 ${chrome}`}
      onPointerDown={keepHere}
      onPointerMove={keepHere}
      onPointerUp={keepHere}
      onPointerCancel={keepHere}
    >
      {panel && versions && (
        <HistoryPanel
          id={panelId}
          t={t}
          photoId={photo.id}
          versions={versions}
          current={photo.ver}
        />
      )}
      {action}
      <div className="flex items-center gap-1">
        <span
          data-testid="lightbox-version"
          className="text-micro uppercase text-white/70 phone:text-[1rem]/6"
        >
          {t("versions.label", { n: photo.ver })}
          {shown?.round != null &&
            ` · ${t("gallery.round", { n: shown.round })}`}
        </span>
        {versions && (
          <button
            type="button"
            data-testid="versions-toggle"
            className={`${BTN} w-auto min-w-11 px-2 text-micro uppercase underline`}
            aria-expanded={panel}
            aria-controls={panel ? panelId : undefined}
            disabled={comparing}
            onClick={() => setOpen((o) => !o)}
          >
            {panel
              ? t("versions.close")
              : t("versions.history", { n: versions.length })}
          </button>
        )}
      </div>
    </div>
  );
}

/** "Ronda 2 · 12/11/2026" (or "Entrega inicial" for a version without a round). */
function useWhen() {
  const fmt = useFormat();
  return (t: TFunction, v: PhotoVersionInfo) => {
    const day = fmt.date(studioParts(v.at, fmt.tz)?.date ?? null) || v.at;
    const round =
      v.round === null
        ? t("versions.initial")
        : t("gallery.round", { n: v.round });
    return `${round} · ${day}`;
  };
}

function HistoryPanel({
  id,
  t,
  photoId,
  versions,
  current,
}: {
  id: string;
  t: TFunction;
  photoId: string;
  versions: PhotoVersionInfo[];
  current: number;
}) {
  const imgUrl = useImgUrl();
  const when = useWhen();
  const [picked, setPicked] = useState(current);
  const pick =
    versions.find((v) => v.n === picked) ?? versions[versions.length - 1];
  return (
    <section
      id={id}
      aria-label={t("versions.title")}
      data-testid="versions-panel"
      className="w-[min(22rem,calc(100vw-2rem))] max-h-[60dvh] overflow-y-auto bg-night/90 p-3 text-white"
    >
      <img
        data-testid="versions-preview"
        src={imgUrl(photoId, "view-sm", pick.v, pick.n)}
        alt={t("versions.preview", { n: pick.n })}
        draggable={false}
        className="mb-3 block max-h-[30dvh] w-full object-contain"
      />
      <ul className="flex flex-col gap-1">
        {[...versions].reverse().map((v) => (
          <li key={v.n}>
            <button
              type="button"
              data-testid={`version-${v.n}`}
              aria-pressed={v.n === pick.n}
              className="flex min-h-11 w-full cursor-pointer items-center gap-3 p-1 text-left hover:bg-white/10 aria-pressed:bg-white/15"
              onClick={() => setPicked(v.n)}
            >
              <img
                src={imgUrl(photoId, "thumb", v.v, v.n)}
                alt=""
                loading="lazy"
                draggable={false}
                className="size-12 shrink-0 object-cover"
              />
              <span className="flex flex-col text-body">
                <span>
                  {t("versions.label", { n: v.n })}
                  {v.n === current && ` · ${t("versions.current")}`}
                </span>
                <span className="text-micro uppercase text-white/70">
                  {when(t, v)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
