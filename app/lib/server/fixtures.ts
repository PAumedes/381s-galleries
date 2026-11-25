import { SAMPLE_ROOT_NAME } from "../sample-root-name";
/**
 * Deterministic fixture tree for the mock Drive (PLAN §3 / §5.9).
 * No Math.random(): a seeded PRNG drives orientation, sizes and times.
 */
import { FOLDER_MIME, SHORTCUT_MIME } from "./drive-types";
import type { DriveFile } from "./drive-types";

export const FIXTURE_ROOT_NAME = SAMPLE_ROOT_NAME;

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

/** Seeded builder of the mock Drive tree: every random draw goes through `rand`, so call order is the fixture. */
class FixtureBuilder {
  readonly entries: MockEntry[] = [];
  private readonly rand = mulberry32(381);
  private n = 0;

  nextId = (kind: string) =>
    `mock-${kind}-${String(++this.n).padStart(5, "0")}`;

  time = () =>
    new Date(
      BASE_TIME + Math.floor(this.rand() * 6 * 3600) * 1000,
    ).toISOString();

  folder(name: string, parentId: string | null): string {
    const id = this.nextId("dir");
    this.entries.push({
      id,
      name,
      mimeType: FOLDER_MIME,
      modifiedTime: this.time(),
      parentId,
    });
    return id;
  }

  photo(
    parentId: string,
    spec: PhotoSpec,
    recipe: Recipe,
    opts: { noMeta?: boolean; trashed?: boolean } = {},
  ) {
    const { rand } = this;
    const { width, height } = dims(spec, recipe);
    const taken = BASE_TIME + Math.floor(rand() * 5 * 3600) * 1000;
    const entry: MockEntry = {
      id: this.nextId("img"),
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
    this.entries.push(entry);
  }

  spec(name: string): PhotoSpec {
    return {
      name,
      aspect: ASPECTS[Math.floor(this.rand() * ASPECTS.length)],
      portrait: this.rand() < 0.4,
    };
  }

  specs(prefix: string, count: number): PhotoSpec[] {
    return Array.from({ length: count }, (_, i) =>
      this.spec(`${prefix}${String(i + 1).padStart(4, "0")}.jpg`),
    );
  }
}

/** Album 1: wedding with sets. */
function weddingAlbum(b: FixtureBuilder, rootId: string) {
  const album = b.folder("2026-11-14 Boda Ana y Juan", rootId);
  const recipes: Recipe[] = ["high-res", "web", "ig", "thumb"];
  const groups: { set: string | null; photos: PhotoSpec[] }[] = [
    { set: null, photos: b.specs("Boda_R", 3) },
    { set: "Ceremonia", photos: b.specs("Cer_", 60) },
    { set: "Fiesta", photos: b.specs("Fie_", 60) },
  ];
  for (const r of recipes) {
    const rid = b.folder(r, album);
    for (const g of groups) {
      const parent = g.set ? b.folder(g.set, rid) : rid;
      for (const p of g.photos) b.photo(parent, p, r);
    }
  }
}

/** Album 2: portrait session with preview-wm. */
function portraitAlbum(b: FixtureBuilder, rootId: string) {
  const album = b.folder("Retrato Sofía", rootId);
  const photos = b.specs("Sofia_", 30);
  for (const r of [
    "high-res",
    "web",
    "ig",
    "thumb",
    "preview-wm",
  ] as Recipe[]) {
    const rid = b.folder(r, album);
    for (const p of photos) b.photo(rid, p, r);
  }
}

/** Folders of the broken album that `coveredAndOrphans` fills. */
type Recipes = { hr: string; web: string; thumb: string };

/** Photos complete in every recipe, orphans of one recipe, and an accented name. */
function coveredAndOrphans(b: FixtureBuilder, { hr, web, thumb }: Recipes) {
  const ok = b.specs("Ok_", 3);
  for (const p of ok) {
    b.photo(hr, p, "high-res");
    b.photo(web, p, "web");
    b.photo(thumb, p, "thumb");
  }
  // thumb with no high-res
  b.photo(thumb, b.spec("Huerfana_thumb.jpg"), "thumb");
  // high-res with no web/thumb
  b.photo(hr, b.spec("Solo_high.jpg"), "high-res");
  // name with spaces and accents
  const acc = b.spec("Café de la Mañana ñandú.jpg");
  b.photo(hr, acc, "high-res");
  b.photo(web, acc, "web");
  b.photo(thumb, acc, "thumb");
}

/** Album 3: deliberately broken (orphans, duplicates, odd names, non-images). */
function brokenAlbum(b: FixtureBuilder, rootId: string) {
  const album = b.folder("Prueba Errores", rootId);
  const hr = b.folder("high-res", album);
  const web = b.folder("web", album);
  const thumb = b.folder("thumb", album);
  coveredAndOrphans(b, { hr, web, thumb });
  // same base name, .jpg vs .JPG
  b.photo(hr, b.spec("Duplicada.jpg"), "high-res");
  b.photo(hr, b.spec("Duplicada.JPG"), "high-res");
  // JPEG without imageMediaMetadata (Drive hasn't extracted it yet)
  b.photo(hr, b.spec("Sin_metadata.jpg"), "high-res", { noMeta: true });
  // two files with the identical name in one folder
  b.photo(hr, b.spec("Gemela.jpg"), "high-res");
  b.photo(hr, b.spec("Gemela.jpg"), "high-res");
  // shortcut
  b.entries.push({
    id: b.nextId("img"),
    name: "Atajo.jpg",
    mimeType: SHORTCUT_MIME,
    modifiedTime: b.time(),
    parentId: hr,
  });
  // trashed file
  b.photo(hr, b.spec("Borrada.jpg"), "high-res", { trashed: true });
  // name containing a slash
  b.photo(hr, b.spec("a/b.jpg"), "high-res");
  // NFD-decomposed accent (e + U+0301)
  b.photo(hr, b.spec("Cafe\u0301_nfd.jpg"), "high-res");
  // non-JPEG
  b.entries.push({
    id: b.nextId("img"),
    name: "notas.txt",
    mimeType: "text/plain",
    size: 120,
    modifiedTime: b.time(),
    parentId: hr,
  });
  // unknown extra folder
  const raw = b.folder("raw", album);
  b.entries.push({
    id: b.nextId("img"),
    name: "RAW_0001.cr3",
    mimeType: "application/octet-stream",
    size: 25_000_000,
    modifiedTime: b.time(),
    parentId: raw,
  });
}

export function buildFixtures(): MockFixtures {
  const b = new FixtureBuilder();
  const rootId = b.folder(FIXTURE_ROOT_NAME, null);
  weddingAlbum(b, rootId);
  portraitAlbum(b, rootId);
  brokenAlbum(b, rootId);
  return { rootId, entries: b.entries };
}
