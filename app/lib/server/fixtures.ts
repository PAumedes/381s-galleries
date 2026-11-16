/**
 * Deterministic fixture tree for the mock Drive (PLAN §3 / §5.9).
 * No Math.random(): a seeded PRNG drives orientation, sizes and times.
 */
import { FOLDER_MIME, SHORTCUT_MIME } from "./drive-types";
import type { DriveFile } from "./drive-types";

export const FIXTURE_ROOT_NAME = "381studios";

/** A Drive entry plus the bookkeeping the mock needs (never leaves the mock). */
export interface MockEntry extends DriveFile {
  parentId: string | null;
}

export interface MockFixtures {
  rootId: string;
  entries: MockEntry[];
}

const JPEG = "image/jpeg";
const BASE_TIME = Date.UTC(2026, 10, 14, 10, 0, 0);

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Recipe = "high-res" | "web" | "ig" | "thumb" | "preview-wm";
const LONG_EDGE: Record<Recipe, number> = {
  "high-res": 2048,
  web: 1200,
  ig: 1080,
  thumb: 600,
  "preview-wm": 2048,
};

/** Aspect ratios (long/short) used for landscape and portrait photos. */
const ASPECTS = [3 / 2, 4 / 3, 5 / 4, 16 / 9];

interface PhotoSpec {
  /** Full file name incl. extension. */
  name: string;
  /** Long/short ratio. */
  aspect: number;
  portrait: boolean;
}

function dims(
  spec: PhotoSpec,
  recipe: Recipe,
): { width: number; height: number } {
  const long = LONG_EDGE[recipe];
  const short = Math.round(long / spec.aspect);
  const width = spec.portrait ? short : long;
  const height = spec.portrait ? long : short;
  return { width, height };
}

export function buildFixtures(): MockFixtures {
  const rand = mulberry32(381);
  const entries: MockEntry[] = [];
  let n = 0;
  const nextId = (kind: string) =>
    `mock-${kind}-${String(++n).padStart(5, "0")}`;
  const time = () =>
    new Date(BASE_TIME + Math.floor(rand() * 6 * 3600) * 1000).toISOString();

  const folder = (name: string, parentId: string | null): string => {
    const id = nextId("dir");
    entries.push({
      id,
      name,
      mimeType: FOLDER_MIME,
      modifiedTime: time(),
      parentId,
    });
    return id;
  };

  const photo = (
    parentId: string,
    spec: PhotoSpec,
    recipe: Recipe,
    opts: { noMeta?: boolean; trashed?: boolean } = {},
  ) => {
    const { width, height } = dims(spec, recipe);
    const taken = BASE_TIME + Math.floor(rand() * 5 * 3600) * 1000;
    const entry: MockEntry = {
      id: nextId("img"),
      name: spec.name,
      mimeType: JPEG,
      size: Math.round(width * height * (0.25 + rand() * 0.2)),
      // Exported after being taken: strictly later than takenAt.
      modifiedTime: new Date(
        taken + (1 + Math.floor(rand() * 3600)) * 1000,
      ).toISOString(),
      parentId,
    };
    if (!opts.noMeta) {
      entry.width = width;
      entry.height = height;
      entry.takenAt = new Date(taken).toISOString().replace(/\.\d{3}Z$/, "Z");
    }
    if (opts.trashed) entry.trashed = true;
    entries.push(entry);
  };

  const spec = (name: string): PhotoSpec => ({
    name,
    aspect: ASPECTS[Math.floor(rand() * ASPECTS.length)],
    portrait: rand() < 0.4,
  });
  const specs = (prefix: string, count: number): PhotoSpec[] =>
    Array.from({ length: count }, (_, i) =>
      spec(`${prefix}${String(i + 1).padStart(4, "0")}.jpg`),
    );

  const rootId = folder(FIXTURE_ROOT_NAME, null);

  // --- Album 1: wedding with sets --------------------------------------
  {
    const album = folder("2026-11-14 Boda Ana y Juan", rootId);
    const recipes: Recipe[] = ["high-res", "web", "ig", "thumb"];
    const groups: { set: string | null; photos: PhotoSpec[] }[] = [
      { set: null, photos: specs("Boda_R", 3) },
      { set: "Ceremonia", photos: specs("Cer_", 60) },
      { set: "Fiesta", photos: specs("Fie_", 60) },
    ];
    for (const r of recipes) {
      const rid = folder(r, album);
      for (const g of groups) {
        const parent = g.set ? folder(g.set, rid) : rid;
        for (const p of g.photos) photo(parent, p, r);
      }
    }
  }

  // --- Album 2: portrait session with preview-wm ------------------------
  {
    const album = folder("Retrato Sofía", rootId);
    const photos = specs("Sofia_", 30);
    for (const r of [
      "high-res",
      "web",
      "ig",
      "thumb",
      "preview-wm",
    ] as Recipe[]) {
      const rid = folder(r, album);
      for (const p of photos) photo(rid, p, r);
    }
  }

  // --- Album 3: deliberately broken -------------------------------------
  {
    const album = folder("Prueba Errores", rootId);
    const hr = folder("high-res", album);
    const web = folder("web", album);
    const thumb = folder("thumb", album);
    const ok = specs("Ok_", 3);
    for (const p of ok) {
      photo(hr, p, "high-res");
      photo(web, p, "web");
      photo(thumb, p, "thumb");
    }
    // thumb with no high-res
    photo(thumb, spec("Huerfana_thumb.jpg"), "thumb");
    // high-res with no web/thumb
    photo(hr, spec("Solo_high.jpg"), "high-res");
    // name with spaces and accents
    const acc = spec("Café de la Mañana ñandú.jpg");
    photo(hr, acc, "high-res");
    photo(web, acc, "web");
    photo(thumb, acc, "thumb");
    // same base name, .jpg vs .JPG
    photo(hr, spec("Duplicada.jpg"), "high-res");
    photo(hr, spec("Duplicada.JPG"), "high-res");
    // JPEG without imageMediaMetadata (Drive hasn't extracted it yet)
    photo(hr, spec("Sin_metadata.jpg"), "high-res", { noMeta: true });
    // two files with the identical name in one folder
    photo(hr, spec("Gemela.jpg"), "high-res");
    photo(hr, spec("Gemela.jpg"), "high-res");
    // shortcut
    entries.push({
      id: nextId("img"),
      name: "Atajo.jpg",
      mimeType: SHORTCUT_MIME,
      modifiedTime: time(),
      parentId: hr,
    });
    // trashed file
    photo(hr, spec("Borrada.jpg"), "high-res", { trashed: true });
    // name containing a slash
    photo(hr, spec("a/b.jpg"), "high-res");
    // NFD-decomposed accent (e + U+0301)
    photo(hr, spec("Cafe\u0301_nfd.jpg"), "high-res");
    // non-JPEG
    entries.push({
      id: nextId("img"),
      name: "notas.txt",
      mimeType: "text/plain",
      size: 120,
      modifiedTime: time(),
      parentId: hr,
    });
    // unknown extra folder
    const raw = folder("raw", album);
    entries.push({
      id: nextId("img"),
      name: "RAW_0001.cr3",
      mimeType: "application/octet-stream",
      size: 25_000_000,
      modifiedTime: time(),
      parentId: raw,
    });
  }

  return { rootId, entries };
}
