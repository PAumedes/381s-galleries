/**
 * Google Drive v3 REST client (read-only). Implements DriveClient via fetch.
 * Never logs or throws the access token.
 */
import { escapeQ, mapFile, parseExifTime, type RawFile } from "./drive-mapping";
import { createRequester, type DriveClientOptions } from "./drive-request";
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

export type { DriveClientOptions };
export { parseExifTime };

type Json = <T>(url: string) => Promise<T>;

const qs = (p: Record<string, string>) => new URLSearchParams(p).toString();

/** Walks all pages of a files.list query, guarding against loops. */
async function listAll(
  json: Json,
  q: string,
  fields: string,
): Promise<RawFile[]> {
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

/** Children of many folders, IDS_PER_CHUNK folders per query; a file with several parents lands under each once. */
async function listChildrenMany(json: Json, folderIds: string[]) {
  const ids = [...new Set(folderIds)];
  const result = new Map<string, DriveFile[]>(ids.map((id) => [id, []]));
  for (let i = 0; i < ids.length; i += IDS_PER_CHUNK) {
    const chunk = ids.slice(i, i + IDS_PER_CHUNK);
    const q = `(${chunk.map((id) => `'${escapeQ(id)}' in parents`).join(" or ")}) and trashed = false`;
    const files = await listAll(json, q, `${FILE_FIELDS},parents`);
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
}

/** Follows the changes feed from `pageToken` to its end; only whether anything changed matters. */
async function listChanges(
  json: Json,
  pageToken: string,
): Promise<DriveChanges> {
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
      throw new DriveError(502, "Drive changes response missing page tokens");
    }
    if (seen.has(page.nextPageToken))
      throw new DriveError(502, "Drive changes pagination loop");
    seen.add(page.nextPageToken);
    token = page.nextPageToken;
  }
}

export function createDriveClient(
  getToken: (forceRefresh?: boolean) => Promise<string>,
  opts: DriveClientOptions = {},
): DriveClient {
  const { request, json, subrequests } = createRequester(getToken, opts);

  return {
    subrequests,

    async listChildren(folderId) {
      const files = await listAll(
        json,
        `'${escapeQ(folderId)}' in parents and trashed = false`,
        FILE_FIELDS,
      );
      return files.map(mapFile);
    },

    listChildrenMany: (folderIds) => listChildrenMany(json, folderIds),

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

    listChanges: (pageToken) => listChanges(json, pageToken),
  };
}
