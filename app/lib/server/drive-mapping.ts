/** Drive v3 file resources -> DriveFile, and query-string escaping. */
import type { DriveFile } from "./drive-types";

export interface RawFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string | number;
  modifiedTime: string;
  trashed?: boolean;
  imageMediaMetadata?: {
    width?: number;
    height?: number;
    time?: string;
    rotation?: number;
  };
  parents?: string[];
}

/** "YYYY:MM:DD HH:MM:SS" (EXIF) -> ISO 8601 (UTC assumed), or undefined. */
export function parseExifTime(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(
    s.trim(),
  );
  if (!m) return undefined;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d ||
    dt.getUTCHours() !== h ||
    dt.getUTCMinutes() !== mi ||
    dt.getUTCSeconds() !== se
  ) {
    return undefined;
  }
  return dt.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function mapFile(r: RawFile): DriveFile {
  const out: DriveFile = {
    id: r.id,
    name: r.name,
    mimeType: r.mimeType,
    modifiedTime: r.modifiedTime,
  };
  if (
    (typeof r.size === "number" && Number.isFinite(r.size)) ||
    (typeof r.size === "string" && /^\d+$/.test(r.size))
  ) {
    out.size = Number(r.size);
  }
  const meta = r.imageMediaMetadata;
  if (meta) {
    const w = typeof meta.width === "number" ? meta.width : undefined;
    const h = typeof meta.height === "number" ? meta.height : undefined;
    const swap = meta.rotation === 1 || meta.rotation === 3;
    const [ow, oh] = swap ? [h, w] : [w, h];
    if (ow !== undefined) out.width = ow;
    if (oh !== undefined) out.height = oh;
    const t = parseExifTime(meta.time);
    if (t) out.takenAt = t;
  }
  if (r.trashed !== undefined) out.trashed = r.trashed;
  return out;
}

export function escapeQ(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
