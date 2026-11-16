/**
 * Contract shared by the real Google Drive client (drive.ts) and the mock
 * (drive-mock.ts). Sync and image/download routes depend only on this.
 * Read-only by design: the app never writes to Drive.
 */

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes; absent for folders. */
  size?: number;
  /** ISO 8601. */
  modifiedTime: string;
  /** From imageMediaMetadata, when Drive provides it. */
  width?: number;
  height?: number;
  /** imageMediaMetadata.time (EXIF capture time) normalized to ISO 8601, if present. */
  takenAt?: string;
  /** True if the file is in the trash (only visible via getMeta). */
  trashed?: boolean;
}

export interface DriveChanges {
  /** True if at least one file changed since the given page token. */
  changed: boolean;
  /** Token to store and pass next time. */
  newStartPageToken: string;
}

export interface StreamOptions {
  /** Raw HTTP Range header value, passed through (e.g. "bytes=0-1023"). */
  range?: string;
}

export interface DriveClient {
  /** All direct children of a folder (handles pagination internally), not trashed. */
  listChildren(folderId: string): Promise<DriveFile[]>;
  /**
   * Children of several folders using as few queries as possible (one paginated
   * query per ~40 ids). Every requested id is a key (empty array if no children).
   * Unknown ids and non-folder ids yield [] (never throw); only requested ids are keys.
   */
  listChildrenMany(folderIds: string[]): Promise<Map<string, DriveFile[]>>;
  /** Number of upstream fetch calls made by this client instance (incl. retries). */
  subrequests(): number;
  /** Metadata of a single file or folder. Throws DriveError(404) if missing. */
  getMeta(id: string): Promise<DriveFile>;
  /**
   * Streams file content. Returns the upstream Response with an unconsumed body
   * (never buffered). Status 200 or 206; errors throw DriveError.
   */
  streamFile(id: string, opts?: StreamOptions): Promise<Response>;
  /** Current changes page token (changes.getStartPageToken). */
  getStartPageToken(): Promise<string>;
  /** Whether anything changed since `pageToken` (pages through changes.list). */
  listChanges(pageToken: string): Promise<DriveChanges>;
}

export class DriveError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Upstream detail (may contain ids); server-log-only, never sent to clients. Capped at 4 KB read. */
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "DriveError";
  }
}
