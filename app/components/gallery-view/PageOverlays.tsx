import type { TFunction } from "../../i18n/t";
import { DownloadMenu } from "../DownloadMenu";
import { EmailGate } from "../EmailGate";
import { Toast } from "../GalleryTopBar";
import { Lightbox } from "../Lightbox";
import type { GalleryPhoto, OpenGallery } from "../types";
import { ALL, FAV } from "./tabs";
import type { useGalleryView } from "./useGalleryView";

type View = ReturnType<typeof useGalleryView>;

/** Everything layered over the page: toast, lightbox, download sheet, email gate. */
export function PageOverlays({
  gallery,
  photos,
  view,
  t,
}: {
  gallery: OpenGallery;
  photos: readonly GalleryPhoto[];
  view: View;
  t: TFunction;
}) {
  const { sheet, favs, active, open, toast, showToast } = view;
  const sheetPhoto =
    sheet?.kind === "single"
      ? photos.find((p) => p.id === sheet.id)
      : undefined;
  return (
    <>
      {toast && <Toast key={toast.n} messageKey={toast.key} />}

      {open !== null && (
        <Lightbox
          photos={view.visible}
          index={open}
          t={t}
          onClose={() => view.setOpen(null)}
          onIndexChange={view.setOpen}
          onFavorite={favs.toggle}
          onDownload={view.openSingle}
          isFavorite={view.isFavorite}
          protect={view.proofing}
        />
      )}

      {sheet && (sheet.kind === "bulk" || sheetPhoto) && (
        <DownloadMenu
          gallery={gallery}
          t={t}
          ensure={favs.ensure}
          onClose={() => view.setSheet(null)}
          onError={() => showToast("download.error")}
          mode={
            sheet.kind === "bulk"
              ? {
                  kind: "bulk",
                  photos,
                  activeSet: active === ALL || active === FAV ? null : active,
                  favoriteIds: favs.ids,
                }
              : { kind: "single", photo: sheetPhoto! }
          }
        />
      )}

      {favs.gateOpen && (
        <EmailGate t={t} onSubmit={favs.submitGate} onClose={favs.closeGate} />
      )}
    </>
  );
}
