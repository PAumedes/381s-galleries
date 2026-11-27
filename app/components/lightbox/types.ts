import type { TFunction } from "../../i18n/t";
import type { GalleryPhoto } from "../types";
import type { ApprovalsApi } from "../use-approvals";

export type LightboxProps = {
  photos: readonly GalleryPhoto[];
  index: number;
  t: TFunction;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onFavorite?: (id: string) => void;
  onDownload?: (id: string) => void;
  /** The placeholder card may offer the original's download (allow_highres). Default true. */
  originalDownload?: boolean;
  isFavorite?: (id: string) => boolean;
  /** Versioned albums (T6.53f): approve the shown version of the photo. */
  approvals?: ApprovalsApi;
  /** Proofing: block "Save image" (overlay above the photo, no context menu). */
  protect?: boolean;
};
