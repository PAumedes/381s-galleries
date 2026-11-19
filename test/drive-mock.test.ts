import { describe, expect, it } from "vitest";
import { createMockDrive, mockImageUrl } from "../app/lib/server/drive-mock";
import { buildFixtures, FIXTURE_ROOT_NAME } from "../app/lib/server/fixtures";
import { DriveError, FOLDER_MIME } from "../app/lib/server/drive-types";
import type { DriveClient, DriveFile } from "../app/lib/server/drive-types";

const RECIPES = ["high-res", "web", "ig", "thumb"];
const isFolder = (f: DriveFile) => f.mimeType === FOLDER_MIME;
const byName = (fs: DriveFile[], n: string) => {
  const f = fs.find((x) => x.name === n);
  if (!f) throw new Error(`missing ${n}`);
  return f;
};

async function walk(d: DriveClient, rootId: string) {
  const albums = await d.listChildren(rootId);
  return (name: string) => byName(albums, name);
}

async function recipe(d: DriveClient, albumId: string, r: string) {
  const f = byName(await d.listChildren(albumId), r);
  return d.listChildren(f.id);
}

describe("fixtures determinism", () => {
  it("builds identical fixtures twice", () => {
    expect(buildFixtures()).toEqual(buildFixtures());
  });
  it("has unique ids", () => {
    const fx = buildFixtures();
    expect(new Set(fx.entries.map((e) => e.id)).size).toBe(fx.entries.length);
  });
});

describe("tree shape", () => {
  const fx = buildFixtures();
  const d = createMockDrive(fx);

  it("root is the sample folder with 3 albums", async () => {
    const root = await d.getMeta(fx.rootId);
    expect(root.name).toBe(FIXTURE_ROOT_NAME);
    expect(root.name).toBe("studio-galleries");
    expect(isFolder(root)).toBe(true);
    const names = (await d.listChildren(fx.rootId)).map((f) => f.name).sort();
    expect(names).toEqual(
      ["2026-11-14 Boda Ana y Juan", "Prueba Errores", "Retrato Sofía"].sort(),
    );
  });

  it("wedding has recipes with Ceremonia/Fiesta sets of 60 and root files", async () => {
    const album = await walk(d, fx.rootId).then((f) =>
      f("2026-11-14 Boda Ana y Juan"),
    );
    const kids = await d.listChildren(album.id);
    expect(kids.map((k) => k.name).sort()).toEqual([...RECIPES].sort());
    for (const r of RECIPES) {
      const items = await recipe(d, album.id, r);
      const sets = items
        .filter(isFolder)
        .map((f) => f.name)
        .sort();
      expect(sets).toEqual(["Ceremonia", "Fiesta"]);
      const rootFiles = items.filter((i) => !isFolder(i));
      expect(rootFiles.length).toBeGreaterThanOrEqual(2);
      for (const s of sets) {
        const files = await d.listChildren(byName(items, s).id);
        expect(files.length).toBe(60);
      }
    }
  });

  it("listChildren returns direct children only", async () => {
    const album = await walk(d, fx.rootId).then((f) =>
      f("2026-11-14 Boda Ana y Juan"),
    );
    const hr = await recipe(d, album.id, "high-res");
    expect(hr.every((f) => f.name !== "IMG_0001.jpg" || !isFolder(f))).toBe(
      true,
    );
    const all = await d.listChildren(fx.rootId);
    expect(all.length).toBe(3);
  });

  it("portrait album has ~30 files at root and preview-wm", async () => {
    const album = await walk(d, fx.rootId).then((f) => f("Retrato Sofía"));
    const names = (await d.listChildren(album.id)).map((k) => k.name);
    expect(names).toContain("preview-wm");
    for (const r of [...RECIPES, "preview-wm"]) {
      const items = await recipe(d, album.id, r);
      expect(items.length).toBe(30);
      expect(items.some(isFolder)).toBe(false);
    }
  });

  it("error album is deliberately broken", async () => {
    const album = await walk(d, fx.rootId).then((f) => f("Prueba Errores"));
    const kids = await d.listChildren(album.id);
    expect(kids.map((k) => k.name)).toContain("raw");
    const hr = (await recipe(d, album.id, "high-res")).map((f) => f.name);
    const web = (await recipe(d, album.id, "web")).map((f) => f.name);
    const thumb = (await recipe(d, album.id, "thumb")).map((f) => f.name);
    // thumb without high-res
    expect(thumb.some((n) => !hr.includes(n))).toBe(true);
    // high-res without web/thumb
    expect(hr.some((n) => !web.includes(n) && !thumb.includes(n))).toBe(true);
    // non-JPEG
    const hrFiles = await recipe(d, album.id, "high-res");
    expect(
      hrFiles.some((f) => f.mimeType !== "image/jpeg" && !isFolder(f)),
    ).toBe(true);
    // accents + spaces
    expect(hr.some((n) => /\s/.test(n) && /[^ -~]/.test(n))).toBe(true);
    // .jpg vs .JPG same base
    const lower = hr
      .filter((n) => n.endsWith(".jpg"))
      .map((n) => n.slice(0, -4));
    const upper = hr
      .filter((n) => n.endsWith(".JPG"))
      .map((n) => n.slice(0, -4));
    expect(lower.some((b) => upper.includes(b))).toBe(true);
  });
});

describe("dimensions", () => {
  const fx = buildFixtures();
  const d = createMockDrive(fx);

  it("consistent per base name, scaled to each recipe", async () => {
    const album = await walk(d, fx.rootId).then((f) =>
      f("2026-11-14 Boda Ana y Juan"),
    );
    const get = async (r: string) => {
      const set = byName(await recipe(d, album.id, r), "Ceremonia");
      return d.listChildren(set.id);
    };
    const [hr, web, ig, thumb] = await Promise.all(RECIPES.map(get));
    const longEdge = (f: DriveFile) => Math.max(f.width!, f.height!);
    let portrait = 0;
    let landscape = 0;
    for (const h of hr) {
      const w = byName(web, h.name);
      const i = byName(ig, h.name);
      const t = byName(thumb, h.name);
      expect(longEdge(h)).toBe(2048);
      expect(longEdge(w)).toBe(1200);
      expect(longEdge(i)).toBe(1080);
      expect(longEdge(t)).toBe(600);
      const ratio = h.width! / h.height!;
      expect(w.width! / w.height!).toBeCloseTo(ratio, 1);
      expect(i.width! / i.height!).toBeCloseTo(ratio, 1);
      expect(t.width! / t.height!).toBeCloseTo(ratio, 1);
      if (h.height! > h.width!) portrait++;
      else landscape++;
      expect(h.mimeType).toBe("image/jpeg");
      expect(h.size).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(h.modifiedTime))).toBe(false);
    }
    expect(portrait).toBeGreaterThan(0);
    expect(landscape).toBeGreaterThan(0);
  });

  it("preview-wm is 2048 long edge", async () => {
    const album = await walk(d, fx.rootId).then((f) => f("Retrato Sofía"));
    for (const f of await recipe(d, album.id, "preview-wm"))
      expect(Math.max(f.width!, f.height!)).toBe(2048);
  });
});

describe("mockImageUrl", () => {
  it("builds picsum url", () => {
    expect(mockImageUrl("abc", "thumb", 600, 400)).toBe(
      "https://picsum.photos/seed/abc/600/400",
    );
    expect(mockImageUrl("abc", "highres", 400, 600)).toBe(
      "https://picsum.photos/seed/abc/1365/2048",
    );
  });
});

describe("DriveClient behaviour", () => {
  it("getMeta throws DriveError 404 for unknown", async () => {
    const d = createMockDrive();
    await expect(d.getMeta("nope")).rejects.toMatchObject({ status: 404 });
    await expect(d.getMeta("nope")).rejects.toBeInstanceOf(DriveError);
  });

  it("listChildren of unknown folder yields []/404-free empty or 404", async () => {
    const d = createMockDrive();
    await expect(d.listChildren("nope")).rejects.toMatchObject({ status: 404 });
  });

  it("streamFile returns a deterministic body with length/type headers", async () => {
    const fx = buildFixtures();
    const d = createMockDrive(fx);
    const f = fx.entries.find((e) => e.mimeType === "image/jpeg")!;
    const res = await d.streamFile(f.id);
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(res.headers.get("Content-Length")).toBe(String(buf.length));
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    const again = new Uint8Array(
      await (await d.streamFile(f.id)).arrayBuffer(),
    );
    expect(again).toEqual(buf);
  });

  it("streamFile honours Range (206) and rejects unsatisfiable (416)", async () => {
    const fx = buildFixtures();
    const d = createMockDrive(fx);
    const f = fx.entries.find((e) => e.mimeType === "image/jpeg")!;
    const full = new Uint8Array(await (await d.streamFile(f.id)).arrayBuffer());
    const res = await d.streamFile(f.id, { range: "bytes=2-9" });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 2-9/${full.length}`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(full.slice(2, 10));
    await expect(
      d.streamFile(f.id, { range: "bytes=99999-" }),
    ).rejects.toMatchObject({ status: 416 });
  });

  it("shuffleSeed reorders listChildren deterministically", async () => {
    const fx = buildFixtures();
    const plain = await createMockDrive(fx).listChildren(fx.rootId);
    const a = await createMockDrive(fx, { shuffleSeed: 7 }).listChildren(
      fx.rootId,
    );
    const b = await createMockDrive(fx, { shuffleSeed: 7 }).listChildren(
      fx.rootId,
    );
    expect(a).toEqual(b);
    expect(a.map((x) => x.id).sort()).toEqual(plain.map((x) => x.id).sort());
  });

  it("getMeta reports trashed files", async () => {
    const fx = buildFixtures();
    const d = createMockDrive(fx);
    const t = fx.entries.find((e) => e.trashed)!;
    expect((await d.getMeta(t.id)).trashed).toBe(true);
  });

  it("streamFile 404 for unknown, error for folders", async () => {
    const fx = buildFixtures();
    const d = createMockDrive(fx);
    await expect(d.streamFile("nope")).rejects.toMatchObject({ status: 404 });
    await expect(d.streamFile(fx.rootId)).rejects.toBeInstanceOf(DriveError);
  });

  it("defaults to the standard fixtures", async () => {
    const d = createMockDrive();
    expect(await d.getStartPageToken()).toBeTypeOf("string");
  });
});

describe("mutations and changes token", () => {
  function setup() {
    const fx = buildFixtures();
    const drive = createMockDrive(fx);
    return { fx, drive };
  }
  async function someFolder(
    drive: DriveClient,
    fx: ReturnType<typeof buildFixtures>,
  ) {
    const album = await walk(drive, fx.rootId).then((f) => f("Retrato Sofía"));
    return byName(await drive.listChildren(album.id), "thumb");
  }

  it("no change => unchanged; mutation => changed with new token", async () => {
    const { fx, drive } = setup();
    const t0 = await drive.getStartPageToken();
    expect(await drive.listChanges(t0)).toEqual({
      changed: false,
      newStartPageToken: t0,
    });
    const folder = await someFolder(drive, fx);
    drive.addFile(folder.id, { name: "new.jpg" });
    const r = await drive.listChanges(t0);
    expect(r.changed).toBe(true);
    expect(r.newStartPageToken).not.toBe(t0);
    expect((await drive.listChanges(r.newStartPageToken)).changed).toBe(false);
  });

  it("addFile appears in listChildren with defaults", async () => {
    const { fx, drive } = setup();
    const folder = await someFolder(drive, fx);
    const f = drive.addFile(folder.id, {
      name: "new.jpg",
      width: 100,
      height: 50,
    });
    expect(f.mimeType).toBe("image/jpeg");
    expect((await drive.listChildren(folder.id)).map((x) => x.id)).toContain(
      f.id,
    );
    expect(await drive.getMeta(f.id)).toEqual(f);
  });

  it("addFile to unknown parent throws 404", () => {
    const { drive } = setup();
    expect(() => drive.addFile("nope", { name: "x.jpg" })).toThrow(DriveError);
  });

  it("removeFile removes and bumps token; unknown throws", async () => {
    const { fx, drive } = setup();
    const folder = await someFolder(drive, fx);
    const [first] = await drive.listChildren(folder.id);
    const t0 = await drive.getStartPageToken();
    drive.removeFile(first.id);
    expect(
      (await drive.listChildren(folder.id)).map((x) => x.id),
    ).not.toContain(first.id);
    await expect(drive.getMeta(first.id)).rejects.toMatchObject({
      status: 404,
    });
    expect((await drive.listChanges(t0)).changed).toBe(true);
    expect(() => drive.removeFile("nope")).toThrow(DriveError);
  });

  it("removeFile on folder removes descendants", async () => {
    const { fx, drive } = setup();
    const folder = await someFolder(drive, fx);
    const [child] = await drive.listChildren(folder.id);
    drive.removeFile(folder.id);
    await expect(drive.getMeta(child.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("renameFile changes name and modifiedTime, bumps token", async () => {
    const { fx, drive } = setup();
    const folder = await someFolder(drive, fx);
    const [first] = await drive.listChildren(folder.id);
    const t0 = await drive.getStartPageToken();
    drive.renameFile(first.id, "renamed.jpg");
    const m = await drive.getMeta(first.id);
    expect(m.name).toBe("renamed.jpg");
    expect(m.modifiedTime > first.modifiedTime).toBe(true);
    expect((await drive.listChanges(t0)).changed).toBe(true);
    expect(() => drive.renameFile("nope", "x")).toThrow(DriveError);
  });

  it("trashFile hides from listChildren and bumps token", async () => {
    const { fx, drive } = setup();
    const folder = await someFolder(drive, fx);
    const [first] = await drive.listChildren(folder.id);
    const n = (await drive.listChildren(folder.id)).length;
    const t0 = await drive.getStartPageToken();
    drive.trashFile(first.id);
    const after = await drive.listChildren(folder.id);
    expect(after.length).toBe(n - 1);
    expect(after.map((x) => x.id)).not.toContain(first.id);
    expect((await drive.listChanges(t0)).changed).toBe(true);
    expect(() => drive.trashFile("nope")).toThrow(DriveError);
  });

  it("does not leak internals and isolates instances", async () => {
    const fx = buildFixtures();
    const a = createMockDrive(fx);
    const b = createMockDrive(fx);
    const folder = await someFolder(a, fx);
    a.addFile(folder.id, { name: "only-a.jpg" });
    expect((await b.listChildren(folder.id)).map((x) => x.name)).not.toContain(
      "only-a.jpg",
    );
    const [f] = await a.listChildren(folder.id);
    expect(Object.keys(f)).not.toContain("parentId");
    expect(Object.keys(f)).not.toContain("trashed");
  });

  it("unknown page token throws 400", async () => {
    const { drive } = setup();
    await expect(drive.listChanges("garbage")).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("mock listChildrenMany and subrequests", () => {
  it("matches listChildren per id and includes every id", async () => {
    const fx = buildFixtures();
    const d = createMockDrive(fx);
    const albums = await d.listChildren(fx.rootId);
    const ids = [fx.rootId, ...albums.map((a) => a.id)];
    const m = await d.listChildrenMany(ids);
    expect([...m.keys()]).toEqual(ids);
    for (const id of ids) expect(m.get(id)).toEqual(await d.listChildren(id));
  });

  it("counts one subrequest per call / 40-id chunk", async () => {
    const fx = buildFixtures();
    const d = createMockDrive(fx);
    expect(d.subrequests()).toBe(0);
    await d.listChildren(fx.rootId);
    await d.getMeta(fx.rootId);
    await d.listChanges("1");
    expect(d.subrequests()).toBe(3);
    await d.listChildrenMany([fx.rootId]);
    expect(d.subrequests()).toBe(4);
    const albums = await d.listChildren(fx.rootId);
    const before = d.subrequests();
    const many = Array.from(
      { length: 41 },
      (_, i) => albums[i % albums.length].id,
    );
    await d.listChildrenMany([...new Set(many)]);
    expect(d.subrequests()).toBe(before + 1);
    const file = (await recipe(d, albums[0].id, "web"))[0];
    const b2 = d.subrequests();
    await d.streamFile(file.id);
    expect(d.subrequests()).toBe(b2 + 1);
  });
});
