import type { TFunction } from "../i18n/t";
import type { GalleryPhoto, OpenGallery } from "./types";

export type DownloadMode =
  | { kind: "single"; photo: GalleryPhoto }
  | {
      kind: "bulk";
      photos: readonly GalleryPhoto[];
      /** The set tab currently shown (null when "all" or favourites). */
      activeSet: string | null;
      favoriteIds: ReadonlySet<string>;
    };

export type DownloadMenuProps = {
  gallery: OpenGallery;
  t: TFunction;
  mode: DownloadMode;
  /** Runs an action behind the email gate (`useVisitor.ensure`). */
  ensure: (action: () => void | Promise<void>) => Promise<void>;
  onClose: () => void;
  onError?: () => void;
};
