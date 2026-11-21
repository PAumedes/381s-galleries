/** Safe, unique names for zip files, folders and entries. */
import type { BulkScope, DlVariant } from "./download-net";

/** Name of the zip a bulk run produces (also the picker's suggestion). */
export function bulkZipName(o: {
  slug: string;
  scope: BulkScope;
  set?: string;
  variant: DlVariant;
}): string {
  const parts = [o.slug, ...(o.scope === "set" && o.set ? [o.set] : [])]
    .map((p) => safeZipName(p, 60))
    .join("-");
  return `${safeZipName(parts, 100)}-${o.variant}.zip`;
}

// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f/\\:]/g;
const MAX_NAME = 120;

/**
 * One safe path segment for a zip entry / zip file: no separators, colons or
 * control chars; whitespace collapsed; no leading/trailing dots or spaces;
 * never "." / ".."; at most 120 code points (a short extension is kept).
 */
export function safeZipName(name: string, max = MAX_NAME): string {
  const clean = name
    .replace(UNSAFE, " ")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "");
  if (!clean) return "_";
  const cps = Array.from(clean);
  if (cps.length <= max) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 ? Array.from(clean.slice(dot)) : [];
  if (ext.length > 0 && ext.length <= 10)
    return (
      cps
        .slice(0, max - ext.length)
        .join("")
        .replace(/[. ]+$/, "") + ext.join("")
    );
  return (
    cps
      .slice(0, max)
      .join("")
      .replace(/[. ]+$/, "") || "_"
  );
}

export function uniqueName(used: Set<string>, path: string): string {
  const slash = path.lastIndexOf("/") + 1;
  const dot = path.lastIndexOf(".");
  const stem = dot > slash ? path.slice(0, dot) : path;
  const ext = dot > slash ? path.slice(dot) : "";
  let name = path;
  for (let n = 2; used.has(name.toLowerCase()); n++)
    name = `${stem} (${n})${ext}`;
  used.add(name.toLowerCase());
  return name;
}

/** Path of a file inside the zip: set folders (scope "all", several sets), safe and unique names. */
export function createZipPaths(opts: {
  scope: BulkScope;
  sets?: ReadonlyMap<string, string>;
}): (token: { photoId: string; filename: string }) => string {
  const folders =
    opts.scope === "all" && opts.sets && new Set(opts.sets.values()).size > 1;
  const used = new Set<string>();
  const folderOf = new Map<string, string>();
  const usedFolders = new Set<string>();
  const folderName = (set: string) => {
    let f = folderOf.get(set);
    if (f === undefined) {
      const stem = safeZipName(set);
      f = stem;
      for (let n = 2; usedFolders.has(f.toLowerCase()); n++)
        f = safeZipName(`${stem} (${n})`);
      usedFolders.add(f.toLowerCase());
      folderOf.set(set, f);
    }
    return f;
  };
  return (token) => {
    const set = opts.sets?.get(token.photoId);
    const path =
      folders && set
        ? `${folderName(set)}/${safeZipName(token.filename)}`
        : safeZipName(token.filename);
    return uniqueName(used, path);
  };
}
