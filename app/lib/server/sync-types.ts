import type { getDb, schema } from "../../db";
import type { DriveClient } from "./drive-types";
import type { Guard } from "./sync-scan";

/** How often the cron checks Drive (every 15 minutes in wrangler.jsonc); the wizard and help say it. */
export const SYNC_INTERVAL_MINUTES = 15;

/** A photo/folder must be missing for longer than this before it is deleted/archived. */
export const SYNC_DELETE_GRACE_MS = 60 * 60_000;

export interface SyncResult {
  skipped?: "unchanged" | "locked" | "no_root" | "empty_root";
  galleries: { created: number; updated: number; archived: number };
  photos: { added: number; updated: number; removed: number };
  issues: number;
  subrequests: number;
}

export type SyncEnv = Pick<Env, "DB" | "CACHE" | "DRIVE_MODE">;

export type Db = ReturnType<typeof getDb>;
export type Row = typeof schema.photos.$inferSelect;
export type GalleryRow = typeof schema.galleries.$inferSelect;
export type BatchItem = Parameters<Db["batch"]>[0][number];

export type Op = (n?: number) => void;

/** What every phase of one sync run needs (Introduce Parameter Object). */
export interface SyncRun {
  env: SyncEnv;
  db: Db;
  drive: DriveClient;
  guard: Guard;
  op: Op;
  now: Date;
}
