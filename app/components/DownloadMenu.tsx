import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { downloadSingle, type DlVariant } from "../lib/download-client";
import { FOCUSABLE, restoreFocus, trapTab, useLatest } from "./dialog-keys";
import { BulkBody } from "./DownloadBulkBody";
import { ROW } from "./DownloadBulkViews";
import type { DownloadMenuProps, DownloadMode } from "./download-menu-types";
import { enabledSizes } from "./download-sizes";
import { Close } from "./icons";
import type { GalleryPhoto } from "./types";

export { enabledSizes };
export type { DownloadMenuProps, DownloadMode };

/**
 * Keyboard of the sheet: focus moves in on open and back to the opener on
 * close; Escape closes (and is hidden from the lightbox underneath); Tab is
 * trapped. A dialog on top (the email gate) keeps the keyboard to itself.
 */
function useSheetKeys(
  dialogRef: RefObject<HTMLDivElement | null>,
  closeRef: RefObject<() => void>,
) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Another dialog (the email gate) on top owns the keyboard.
      const other =
        (e.target as Element | null)?.closest?.('[role="dialog"]') ??
        document.activeElement?.closest?.('[role="dialog"]');
      if (other && other !== dialogRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        // The sheet owns Escape: nothing underneath (the lightbox) may see it.
        e.stopPropagation();
        e.stopImmediatePropagation();
        closeRef.current();
      } else if (e.key === "Tab") {
        trapTab(e, dialogRef.current);
      }
    };
    // Capture phase so we run before (and can shield) listeners underneath.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      restoreFocus(opener);
    };
  }, [dialogRef, closeRef]);
}

export function DownloadMenu(props: DownloadMenuProps) {
  const { t, onClose } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const [confirming, setConfirming] = useState(false);
  // While a bulk run is going, closing asks first instead of aborting.
  const requestClose = () => {
    if (runningRef.current) setConfirming(true);
    else onClose();
  };
  const closeRef = useLatest(requestClose);
  const title = t(
    props.mode.kind === "single" ? "download.photo" : "download.title",
  );

  useSheetKeys(dialogRef, closeRef);

  return (
    <div
      className="fixed inset-0 z-(--z-sheet) flex items-end justify-center bg-black/50 sm:items-center sm:px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-paper text-ink relative flex max-h-dvh w-full flex-col gap-5 overflow-y-auto p-6 sm:w-[420px] sm:p-8"
      >
        <button
          type="button"
          onClick={requestClose}
          aria-label={t("lightbox.close")}
          className="text-grey-600 hover:text-ink absolute top-1 right-1 flex size-11 items-center justify-center"
        >
          <Close className="size-5" aria-hidden="true" />
        </button>
        <h2 className="text-micro-label pr-8 uppercase">{title}</h2>
        {props.mode.kind === "single" ? (
          <SingleBody {...props} photo={props.mode.photo} />
        ) : (
          <BulkBody
            {...props}
            mode={props.mode}
            runningRef={runningRef}
            confirming={confirming}
            setConfirming={setConfirming}
          />
        )}
      </div>
    </div>
  );
}

function SingleBody({
  gallery,
  t,
  ensure,
  onClose,
  onError,
  photo,
}: DownloadMenuProps & { photo: GalleryPhoto }) {
  const pick = (variant: DlVariant) => {
    onClose();
    ensure(() => downloadSingle(gallery.slug, photo.id, variant)).catch(() =>
      onError?.(),
    );
  };
  return (
    <ul className="flex flex-col">
      {enabledSizes(gallery, photo).map((s) => (
        <li
          key={s.variant}
          className="border-grey-200 border-t first:border-t-0"
        >
          <button
            type="button"
            onClick={() => pick(s.variant)}
            className={`${ROW} hover:bg-grey-50`}
          >
            {t(s.key)}
          </button>
        </li>
      ))}
    </ul>
  );
}
