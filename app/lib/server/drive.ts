/**
 * Google Drive v3 REST client (read-only). Implements DriveClient via fetch.
 * Never logs or throws the access token.
 */
import {
  type DriveChanges,
  type DriveClient,
  DriveError,
  type DriveFile,
  type StreamOptions,
} from "./drive-types";

const BASE = "https://www.googleapis.com/drive/v3";
const FILE_FIELDS =
  "id,name,mimeType,size,modifiedTime,trashed,imageMediaMetadata(width,height,time,rotation)";
const MAX_PAGES = 50;
const IDS_PER_CHUNK = 40;
const MAX_RETRIES = 3;
const MAX_ERROR_BODY = 4096;
const BASE_DELAY_MS = 500;
const MAX_RETRY_AFTER_MS = 30_000;

export interface DriveClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface RawFile {
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

function mapFile(r: RawFile): DriveFile {
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

async function readCapped(res: Response, cap: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(Math.min(total, cap));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, buf.length - off);
    buf.set(part, off);
    off += part.length;
    if (off >= buf.length) break;
  }
  return new TextDecoder().decode(buf);
}

function escapeQ(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function createDriveClient(
  getToken: (forceRefresh?: boolean) => Promise<string>,
  opts: DriveClientOptions = {},
): DriveClient {
  const doFetch = opts.fetch ?? ((i, init) => fetch(i, init));
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function toError(res: Response, token: string): Promise<DriveError> {
    let detail: string | undefined;
    try {
      const text = await readCapped(res, MAX_ERROR_BODY);
      try {
        const j = JSON.parse(text) as { error?: { message?: string } };
        if (typeof j?.error?.message === "string") detail = j.error.message;
      } catch {
        // non-JSON body: no detail
      }
    } catch {
      // ignore body read failures
    }
    if (detail && token) detail = detail.split(token).join("[redacted]");
    return new DriveError(
      res.status,
      `Drive request failed (${res.status})`,
      detail,
    );
  }

  async function isRateLimit403(res: Response): Promise<boolean> {
    if (res.status !== 403) return false;
    try {
      const j = (await res.clone().json()) as {
        error?: { errors?: { reason?: string }[]; status?: string };
      };
      return !!j.error?.errors?.some(
        (e) =>
          e.reason === "rateLimitExceeded" ||
          e.reason === "userRateLimitExceeded",
      );
    } catch {
      return false;
    }
  }

  function delayFor(attempt: number, res: Response): number {
    const exp = BASE_DELAY_MS * 2 ** attempt;
    const delay = exp + Math.random() * exp * 0.5;
    const ra = res.headers.get("retry-after");
    if (ra) {
      const secs = Number(ra);
      let ms = Number.NaN;
      if (Number.isFinite(secs)) ms = secs * 1000;
      else {
        const when = Date.parse(ra);
        if (!Number.isNaN(when)) ms = when - Date.now();
      }
      if (Number.isFinite(ms) && ms > 0) {
        return Math.min(Math.max(ms, delay), MAX_RETRY_AFTER_MS);
      }
    }
    return delay;
  }

  let subrequestCount = 0;

  async function request(
    url: string,
    headers: Record<string, string> = {},
    streaming = false,
  ): Promise<Response> {
    let token = await getToken();
    let refreshed = false;
    let retries = 0;
    for (;;) {
      let res: Response;
      try {
        subrequestCount++;
        res = await doFetch(url, {
          method: "GET",
          headers: { ...headers, Authorization: `Bearer ${token}` },
        });
      } catch {
        if (retries < MAX_RETRIES) {
          const exp = BASE_DELAY_MS * 2 ** retries;
          retries++;
          await sleep(exp + Math.random() * exp * 0.5);
          continue;
        }
        throw new DriveError(503, "Drive request failed (network)");
      }
      if (res.ok) return res;
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await res.body?.cancel().catch(() => {});
        token = await getToken(true);
        continue;
      }
      if (streaming) throw await toError(res, token);
      const retryable =
        res.status === 429 || res.status >= 500 || (await isRateLimit403(res));
      if (retryable && retries < MAX_RETRIES) {
        const wait = delayFor(retries, res);
        retries++;
        await res.body?.cancel().catch(() => {});
        await sleep(wait);
        continue;
      }
      throw await toError(res, token);
    }
  }

  async function json<T>(url: string): Promise<T> {
    const res = await request(url);
    try {
      return (await res.json()) as T;
    } catch {
      await res.body?.cancel().catch(() => {});
      throw new DriveError(502, "Drive returned an invalid response");
    }
  }

  const qs = (p: Record<string, string>) => new URLSearchParams(p).toString();

  /** Walks all pages of a files.list query, guarding against loops. */
  async function listAll(q: string, fields: string): Promise<RawFile[]> {
    const out: RawFile[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;
    let pages = 0;
    do {
      if (++pages > MAX_PAGES)
        throw new DriveError(502, "Drive listing exceeded page limit");
      const params: Record<string, string> = {
        q,
        fields: `nextPageToken,files(${fields})`,
        pageSize: "1000",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      };
      if (pageToken) params.pageToken = pageToken;
      const page = await json<{ nextPageToken?: string; files?: RawFile[] }>(
        `${BASE}/files?${qs(params)}`,
      );
      out.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
      if (pageToken) {
        if (seen.has(pageToken))
          throw new DriveError(502, "Drive pagination loop");
        seen.add(pageToken);
      }
    } while (pageToken);
    return out;
  }

  return {
    subrequests: () => subrequestCount,

    async listChildren(folderId) {
      const files = await listAll(
        `'${escapeQ(folderId)}' in parents and trashed = false`,
        FILE_FIELDS,
      );
      return files.map(mapFile);
    },

    async listChildrenMany(folderIds) {
      const ids = [...new Set(folderIds)];
      const result = new Map<string, DriveFile[]>(ids.map((id) => [id, []]));
      for (let i = 0; i < ids.length; i += IDS_PER_CHUNK) {
        const chunk = ids.slice(i, i + IDS_PER_CHUNK);
        const q = `(${chunk.map((id) => `'${escapeQ(id)}' in parents`).join(" or ")}) and trashed = false`;
        const files = await listAll(q, `${FILE_FIELDS},parents`);
        const inChunk = new Set(chunk);
        const seen = new Map<string, Set<string>>();
        for (const raw of files) {
          const mapped = mapFile(raw);
          for (const parent of raw.parents ?? []) {
            if (!inChunk.has(parent)) continue;
            let s = seen.get(parent);
            if (!s) seen.set(parent, (s = new Set()));
            if (s.has(raw.id)) continue;
            s.add(raw.id);
            result.get(parent)?.push(mapped);
          }
        }
      }
      return result;
    },

    async getMeta(id) {
      const raw = await json<RawFile>(
        `${BASE}/files/${encodeURIComponent(id)}?${qs({ fields: FILE_FIELDS, supportsAllDrives: "true" })}`,
      );
      return mapFile(raw);
    },

    async streamFile(id, o?: StreamOptions) {
      const headers: Record<string, string> = {};
      if (o?.range) headers.Range = o.range;
      return request(
        `${BASE}/files/${encodeURIComponent(id)}?${qs({ alt: "media", supportsAllDrives: "true" })}`,
        headers,
        true,
      );
    },

    async getStartPageToken() {
      const r = await json<{ startPageToken: string }>(
        `${BASE}/changes/startPageToken?${qs({ supportsAllDrives: "true" })}`,
      );
      return r.startPageToken;
    },

    async listChanges(pageToken): Promise<DriveChanges> {
      let changed = false;
      let token = pageToken;
      const seen = new Set<string>([pageToken]);
      for (let pages = 1; ; pages++) {
        if (pages > MAX_PAGES)
          throw new DriveError(502, "Drive changes exceeded page limit");
        const page = await json<{
          nextPageToken?: string;
          newStartPageToken?: string;
          changes?: { fileId?: string }[];
        }>(
          `${BASE}/changes?${qs({
            pageToken: token,
            fields: "nextPageToken,newStartPageToken,changes(fileId)",
            pageSize: "1000",
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
          })}`,
        );
        if ((page.changes?.length ?? 0) > 0) changed = true;
        if (page.newStartPageToken) {
          return { changed, newStartPageToken: page.newStartPageToken };
        }
        if (!page.nextPageToken) {
          throw new DriveError(
            502,
            "Drive changes response missing page tokens",
          );
        }
        if (seen.has(page.nextPageToken))
          throw new DriveError(502, "Drive changes pagination loop");
        seen.add(page.nextPageToken);
        token = page.nextPageToken;
      }
    },
  };
}
