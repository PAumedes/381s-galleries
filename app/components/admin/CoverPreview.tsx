import { useNavigation } from "react-router";

import type { GalleryActionResult } from "../../lib/server/admin-galleries";
import type { CoverLayout, Palette } from "../../lib/design";
import type { Versions } from "../img-url";
import type { PreviewDevice } from "./LivePreview";
import { FocalStep } from "./cover-preview/FocalStep";
import { LiveStep } from "./cover-preview/LiveStep";
import type { ChooserPhoto, MobileCover } from "./cover-preview/types";
import { useCoverEditor } from "./cover-preview/use-cover-editor";
import type { Focus } from "./use-focal-drag";

export type { ChooserPhoto, MobileCover } from "./cover-preview/types";

type CoverPreviewProps = {
  title: string;
  eventDate: string | null;
  palette: Palette;
  coverLayout: CoverLayout;
  proofing: boolean;
  /** Effective cover photo (chosen, else the first); null = no photos. */
  coverId: string | null;
  /** Pixel size of the cover photo (aspect for the focal point); null = unknown. */
  coverWidth?: number | null;
  coverHeight?: number | null;
  initialFocus: Focus | null;
  actionData?: GalleryActionResult;
  /** Optional mobile cover (own photo + focal point). */
  mobileCover?: MobileCover | null;
  /** Prueba: the chosen mobile cover has no preview-wm (desktop one is used). */
  mobileNoWm?: boolean;
  /** Photos offered by "Cambiar foto". */
  photos?: readonly ChooserPhoto[];
  /** The desktop cover is automatic (first photo). */
  coverAuto?: boolean;
  /** Admin image tokens by photo id (`?v=`). */
  versions?: Versions;
  /** Controlled device (optional; shared with the editor's other previews). */
  device?: PreviewDevice;
  onDevice?: (d: PreviewDevice) => void;
};

/**
 * "Portada": two connected cards. 1. Elegí el punto focal: the WHOLE photo
 * (uncropped) of the cover being edited (desktop, or the optional mobile one)
 * with a crosshair; a click, tap or arrow keys set the focal point (a point
 * on the image, percent of its width/height), stored only with "Guardar
 * punto focal". 2. Así se ve: the real `CoverHero` at a desktop or phone
 * size. One device switch drives both cards. Without a mobile cover, phones
 * show the desktop cover with its own focal point (the picker then edits it).
 */
export function CoverPreview({
  title,
  eventDate,
  palette,
  coverLayout,
  proofing,
  coverId,
  coverWidth = null,
  coverHeight = null,
  initialFocus,
  actionData,
  mobileCover = null,
  mobileNoWm = false,
  photos = [],
  coverAuto = false,
  versions,
  device: deviceProp,
  onDevice,
}: CoverPreviewProps) {
  const busy = useNavigation().state !== "idle";
  const editor = useCoverEditor({
    coverId,
    coverWidth,
    coverHeight,
    initialFocus,
    mobileCover,
    device: deviceProp,
    onDevice,
  });
  const fb =
    actionData?.intent === "focus" || actionData?.intent === "cover"
      ? actionData
      : undefined;

  return (
    <div
      data-testid="cover-preview"
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10"
    >
      <FocalStep
        editor={editor}
        coverId={coverId}
        hasMobileCover={!!mobileCover}
        mobileNoWm={mobileNoWm}
        photos={photos}
        coverAuto={coverAuto}
        versions={versions}
        busy={busy}
        feedback={fb}
      />
      <LiveStep
        editor={editor}
        coverId={coverId}
        mobileCover={mobileCover}
        preview={{ title, eventDate, palette, coverLayout, proofing, versions }}
      />
    </div>
  );
}
