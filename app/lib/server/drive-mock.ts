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

const IDS_PER_CHUNK = 40;

/** The mutable world of one mock Drive: entries, change token, deterministic clock, subrequest count. */
class MockStore {
  readonly entries: Map<string, MockEntry>;
  token = 1;
  counter = 0;
  subs = 0;
  private clock: number;
  private readonly shuffleRand: (() => number) | null;

  constructor(fx: MockFixtures, options: MockOptions) {
    this.entries = new Map(fx.entries.map((e) => [e.id, { ...e }]));
    // Deterministic clock for mutations: one second past the latest known time.
    this.clock = Math.max(
      0,
      ...[...this.entries.values()]
        .map((e) => Date.parse(e.modifiedTime))
        .filter((t) => Number.isFinite(t)),
    );
    this.shuffleRand =
      options.shuffleSeed === undefined
        ? null
        : mulberry32(options.shuffleSeed);
  }

  tick = () => new Date((this.clock += 1000)).toISOString();

  need(id: string): MockEntry {
    const e = this.entries.get(id);
    if (!e) throw new DriveError(404, `File not found: ${id}`);
    return e;
  }

  list(folderId: string): DriveFile[] {
    const parent = this.need(folderId);
    if (parent.mimeType !== FOLDER_MIME)
      throw new DriveError(400, "Not a folder");
    const out = [...this.entries.values()]
      .filter((e) => e.parentId === folderId && !e.trashed)
      .map(strip);
    const rand = this.shuffleRand;
    if (rand)
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
    return out;
  }

  /** Bumps the parent's modified time (when it still exists). */
  touchParent(e: MockEntry) {
    const parent = e.parentId ? this.entries.get(e.parentId) : undefined;
    if (parent) parent.modifiedTime = this.tick();
  }
}

/** The 200 or 206 response for a mock file, honouring a single `bytes=a-b` / `bytes=-n` range. */
function mockFileResponse(id: string, e: MockEntry, range?: string) {
  const body = mockBody(id);
  const total = body.length;
  const headers: Record<string, string> = {
    "Content-Type": e.mimeType,
    "Accept-Ranges": "bytes",
  };
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (range && (!m || (m[1] === "" && m[2] === ""))) {
    throw new DriveError(416, "Range not satisfiable");
  }
  if (!m) {
    headers["Content-Length"] = String(total);
    return new Response(body, { status: 200, headers });
  }
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

/** The read-only DriveClient surface over a store. */
function mockReads(st: MockStore): DriveClient {
  return {
    subrequests: () => st.subs,
    async listChildren(folderId) {
      st.subs++;
      return st.list(folderId);
    },
    async listChildrenMany(folderIds) {
      const ids = [...new Set(folderIds)];
      const result = new Map<string, DriveFile[]>();
      for (let i = 0; i < ids.length; i += IDS_PER_CHUNK) {
        st.subs++;
        for (const id of ids.slice(i, i + IDS_PER_CHUNK)) {
          const e = st.entries.get(id);
          result.set(id, e && e.mimeType === FOLDER_MIME ? st.list(id) : []);
        }
      }
      return result;
    },
    async getMeta(id) {
      st.subs++;
      return strip(st.need(id));
    },
    async streamFile(id, opts?: StreamOptions) {
      st.subs++;
      const e = st.need(id);
      if (e.mimeType === FOLDER_MIME)
        throw new DriveError(400, "Cannot download a folder");
      return mockFileResponse(id, e, opts?.range);
    },
    async getStartPageToken() {
      return String(st.token);
    },
    async listChanges(pageToken): Promise<DriveChanges> {
      st.subs++;
      const since = /^\d+$/.test(pageToken) ? Number(pageToken) : NaN;
      if (Number.isNaN(since)) throw new DriveError(400, "Invalid page token");
      return {
        changed: st.token > since,
        newStartPageToken: String(st.token),
      };
    },
  };
}

/** The fixture mutations tests use to simulate Drive changes (each bumps the change token). */
function mockMutations(
  st: MockStore,
): Pick<MockDrive, "addFile" | "removeFile" | "renameFile" | "trashFile"> {
  return {
    addFile(parentId, file) {
      const parent = st.need(parentId);
      if (parent.mimeType !== FOLDER_MIME)
        throw new DriveError(400, "Parent is not a folder");
      if (file.id !== undefined && st.entries.has(file.id))
        throw new DriveError(409, `File already exists: ${file.id}`);
      const entry: MockEntry = {
        mimeType: "image/jpeg",
        ...file,
        id: file.id || `mock-add-${String(++st.counter).padStart(5, "0")}`,
        modifiedTime: file.modifiedTime ?? st.tick(),
        parentId,
      };
      st.entries.set(entry.id, entry);
      parent.modifiedTime = st.tick();
      st.token++;
      return strip(entry);
    },
    removeFile(id) {
      const target = st.need(id);
      const parent = target.parentId
        ? st.entries.get(target.parentId)
        : undefined;
      const drop = (x: string) => {
        for (const e of st.entries.values()) if (e.parentId === x) drop(e.id);
        st.entries.delete(x);
      };
      drop(id);
      if (parent) parent.modifiedTime = st.tick();
      st.token++;
    },
    renameFile(id, name) {
      const e = st.need(id);
      e.name = name;
      e.modifiedTime = st.tick();
      st.touchParent(e);
      st.token++;
      return strip(e);
    },
    trashFile(id) {
      const e = st.need(id);
      e.trashed = true;
      st.touchParent(e);
      st.token++;
    },
  };
}

export function createMockDrive(
  fixtures?: MockFixtures,
  options: MockOptions = {},
): MockDrive {
  const st = new MockStore(fixtures ?? buildFixtures(), options);
  return { ...mockReads(st), ...mockMutations(st) };
}
