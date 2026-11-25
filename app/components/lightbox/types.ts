import type { TFunction } from "../../i18n/t";
import type { GalleryPhoto } from "../types";

export type LightboxProps = {
  photos: readonly GalleryPhoto[];
  index: number;
  t: TFunction;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onFavorite?: (id: string) => void;
  onDownload?: (id: string) => void;
  isFavorite?: (id: string) => boolean;
  /** Proofing: block "Save image" (overlay above the photo, no context menu). */
  protect?: boolean;
};
