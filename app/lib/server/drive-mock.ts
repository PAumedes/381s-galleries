/**
 * In-memory DriveClient for development and tests (PLAN §5.9).
 *
 * `streamFile` returns a small deterministic in-memory body and honours Range.
 * In mock mode the /img and /dl routes (not this mock) respond with a 302 to
 * mockImageUrl(photoId, variant, width, height).
 */
import { DriveError, FOLDER_MIME } from "./drive-types";
import type {
  DriveChanges,
  DriveClient,
  DriveFile,
  StreamOptions,
} from "./drive-types";
import { buildFixtures, mulberry32 } from "./fixtures";
import type { MockEntry, MockFixtures } from "./fixtures";

export type MockVariant = "thumb" | "web" | "ig" | "highres" | "wm";

const VARIANT_LONG_EDGE: Record<MockVariant, number> = {
  thumb: 600,
  web: 1200,
  ig: 1080,
  highres: 2048,
  wm: 2048,
};

/**
 * picsum URL for a photo variant. `photoId` is the opaque DB id (never a Drive
 * id) and is the seed, so all variants of a photo show the same picture.
 * `width`/`height` give the photo's aspect ratio; the variant sets the long edge.
 */
export function mockImageUrl(
  photoId: string,
  variant: MockVariant,
  width: number,
  height: number,
): string {
  const long = VARIANT_LONG_EDGE[variant];
  // Photos without imageMediaMetadata have no dimensions: fall back to square.
  if (!(
    width > 0 &&
    height > 0 &&
    Number.isFinite(width) &&
    Number.isFinite(height)
  )) {
    width = 1;
    height = 1;
  }
  const max = Math.max(width, height);
  const w = Math.max(1, Math.round((long * width) / max));
  const h = Math.max(1, Math.round((long * height) / max));
  return `https://picsum.photos/seed/${encodeURIComponent(photoId)}/${w}/${h}`;
}

function mockBody(id: string): Uint8Array<ArrayBuffer> {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++)
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const rand = mulberry32(h >>> 0);
  const out = new Uint8Array(new ArrayBuffer(256 + ((h >>> 0) % 256)));
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

export interface MockDrive extends DriveClient {
  addFile(
    parentId: string,
    file: Partial<DriveFile> & { name: string },
  ): DriveFile;
  removeFile(id: string): void;
  renameFile(id: string, name: string): DriveFile;
  trashFile(id: string): void;
}

const strip = ({ parentId: _p, trashed, ...file }: MockEntry): DriveFile =>
  trashed ? { ...file, trashed: true } : { ...file };

export interface MockOptions {
  /** Deterministically shuffle listChildren order (Drive order is unspecified). */
  shuffleSeed?: number;
}

export function createMockDrive(
  fixtures?: MockFixtures,
  options: MockOptions = {},
): MockDrive {
  const fx = fixtures ?? buildFixtures();
  const entries = new Map<string, MockEntry>(
    fx.entries.map((e) => [e.id, { ...e }]),
  );
  let token = 1;
  // Deterministic clock for mutations: one second past the latest known time.
  let clock = Math.max(
    0,
    ...[...entries.values()]
      .map((e) => Date.parse(e.modifiedTime))
      .filter((t) => Number.isFinite(t)),
  );
  const shuffleRand =
    options.shuffleSeed === undefined ? null : mulberry32(options.shuffleSeed);
  let counter = 0;
  let subs = 0;
  const tick = () => new Date((clock += 1000)).toISOString();

  const need = (id: string): MockEntry => {
    const e = entries.get(id);
    if (!e) throw new DriveError(404, `File not found: ${id}`);
    return e;
  };

  const list = (folderId: string): DriveFile[] => {
    const parent = need(folderId);
    if (parent.mimeType !== FOLDER_MIME) throw new DriveError(400, "Not a folder");
    const out = [...entries.values()]
      .filter((e) => e.parentId === folderId && !e.trashed)
      .map(strip);
    if (shuffleRand)
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(shuffleRand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
    return out;
  };

  return {
    subrequests: () => subs,
    async listChildren(folderId) {
      subs++;
      return list(folderId);
    },
    async listChildrenMany(folderIds) {
      const ids = [...new Set(folderIds)];
      const result = new Map<string, DriveFile[]>();
      for (let i = 0; i < ids.length; i += 40) {
        subs++;
        for (const id of ids.slice(i, i + 40)) {
          const e = entries.get(id);
          result.set(id, e && e.mimeType === FOLDER_MIME ? list(id) : []);
        }
      }
      return result;
    },
    async getMeta(id) {
      subs++;
      return strip(need(id));
    },
    async streamFile(id, opts?: StreamOptions) {
      subs++;
      const e = need(id);
      if (e.mimeType === FOLDER_MIME)
        throw new DriveError(400, "Cannot download a folder");
      const body = mockBody(id);
      const total = body.length;
      const headers: Record<string, string> = {
        "Content-Type": e.mimeType,
        "Accept-Ranges": "bytes",
      };
      const m = opts?.range
        ? /^bytes=(\d*)-(\d*)$/.exec(opts.range.trim())
        : null;
      if (opts?.range && (!m || (m[1] === "" && m[2] === ""))) {
        throw new DriveError(416, "Range not satisfiable");
      }
      if (m) {
        let start: number;
        let end: number;
        if (m[1] === "") {
          const n = Number(m[2]);
          if (n === 0) throw new DriveError(416, "Range not satisfiable");
          start = Math.max(0, total - n);
          end = total - 1;
        } else {
          start = Number(m[1]);
          end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
        }
        if (start >= total || start > end)
          throw new DriveError(416, "Range not satisfiable");
        const part = body.slice(start, end + 1);
        headers["Content-Length"] = String(part.length);
        headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
        return new Response(part, { status: 206, headers });
      }
      headers["Content-Length"] = String(total);
      return new Response(body, { status: 200, headers });
    },
    async getStartPageToken() {
      return String(token);
    },
    async listChanges(pageToken): Promise<DriveChanges> {
      subs++;
      const since = /^\d+$/.test(pageToken) ? Number(pageToken) : NaN;
      if (Number.isNaN(since)) throw new DriveError(400, "Invalid page token");
      return { changed: token > since, newStartPageToken: String(token) };
    },
    addFile(parentId, file) {
      const parent = need(parentId);
      if (parent.mimeType !== FOLDER_MIME)
        throw new DriveError(400, "Parent is not a folder");
      if (file.id !== undefined && entries.has(file.id))
        throw new DriveError(409, `File already exists: ${file.id}`);
      const entry: MockEntry = {
        mimeType: "image/jpeg",
        ...file,
        id: file.id || `mock-add-${String(++counter).padStart(5, "0")}`,
        modifiedTime: file.modifiedTime ?? tick(),
        parentId,
      };
      entries.set(entry.id, entry);
      parent.modifiedTime = tick();
      token++;
      return strip(entry);
    },
    removeFile(id) {
      const target = need(id);
      const parent = target.parentId ? entries.get(target.parentId) : undefined;
      const drop = (x: string) => {
        for (const e of entries.values()) if (e.parentId === x) drop(e.id);
        entries.delete(x);
      };
      drop(id);
      if (parent) parent.modifiedTime = tick();
      token++;
    },
    renameFile(id, name) {
      const e = need(id);
      e.name = name;
      e.modifiedTime = tick();
      const parent = e.parentId ? entries.get(e.parentId) : undefined;
      if (parent) parent.modifiedTime = tick();
      token++;
      return strip(e);
    },
    trashFile(id) {
      const e = need(id);
      e.trashed = true;
      const parent = e.parentId ? entries.get(e.parentId) : undefined;
      if (parent) parent.modifiedTime = tick();
      token++;
    },
  };
}
