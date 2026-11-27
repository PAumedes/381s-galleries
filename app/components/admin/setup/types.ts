import type { SweepState } from "../../../lib/server/orphan-sweep-action";

export interface SetupViewData {
  connected: boolean;
  mock: boolean;
  rootName: string | null;
  studioName: string;
  lastSyncAt: string | null;
  /** Photos whose R2 cache is warm vs visible photos. */
  cacheWarm?: { warmed: number; total: number };
  /** Versions of the uploaded logos (null = bundled). */
  logo?: { onLight: string | null; onDark: string | null };
  lastError: { at: string; message: string } | null;
  /** Deleted galleries' Drive folders that sync skips (only id + date are kept). */
  ignoredFolders?: { handle: string; deletedAt: string }[];
}

export interface SetupActionData {
  intent: string;
  ok: boolean;
  error?: string;
  message?: string;
  result?: {
    skipped?: string;
    galleries: { created: number; updated: number; archived: number };
    photos: { added: number; updated: number; removed: number };
    issues: number;
  };
  /** Orphan cache sweep progress (T6.59): numbers only. */
  sweep?: SweepState;
}
