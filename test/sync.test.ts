import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../app/db";
import { createMockDrive } from "../app/lib/server/drive-mock";
import type { MockDrive } from "../app/lib/server/drive-mock";
import { buildFixtures } from "../app/lib/server/fixtures";
import type { MockEntry, MockFixtures } from "../app/lib/server/fixtures";
import { DriveError, FOLDER_MIME } from "../app/lib/server/drive-types";
import type { DriveClient } from "../app/lib/server/drive-types";
import { runScheduledSync, runSync } from "../app/lib/server/sync";
import {
  getDrive,
  getRootFolderId,
  resetMockDrive,
} from "../app/lib/server/drive-factory";
import { handleSync } from "../app/routes/api.admin.sync";

const e = {
  ...env,
  DRIVE_MODE: "mock",
  ALLOW_DEV_ADMIN: "1",
} as Env;
const db = getDb(env);
const later = () => new Date(Date.now() + 2 * 3600_000); // past the sync grace

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});

beforeEach(async () => {
  resetMockDrive();
  await db.delete(schema.galleries);
  await db.delete(schema.settings);
  const l = await env.CACHE.list();
  for (const o of l.objects) await env.CACHE.delete(o.key);
});

async function setRoot(id: string) {
  await db.insert(schema.settings).values({ key: "drive_root_id", value: id });
}

async function findChild(d: DriveClient, parent: string, name: string) {
  const kids = await d.listChildren(parent);
  const k = kids.find((x) => x.name === name);
  if (!k) throw new Error(`missing ${name}`);
  return k;
}
async function walk(d: DriveClient, root: string, ...path: string[]) {
  let id = root;
  for (const p of path) id = (await findChild(d, id, p)).id;
  return id;
}

const galleryBy = async (slug: string) => {
  const [g] = await db
    .select()
    .from(schema.galleries)
    .where(eq(schema.galleries.slug, slug));
  return g;
};
const photosOf = (galleryId: string) =>
  db.select().from(schema.photos).where(eq(schema.photos.galleryId, galleryId));
const issuesOf = (g: { syncIssuesJson: string | null }) =>
  JSON.parse(g.syncIssuesJson ?? "[]") as {
    type: string;
    set: string | null;
    name: string;
  }[];

/** Build a custom fixture tree: albums = {name: {recipe: {set|"": [files]}}} */
function tree(
  albums: Record<
    string,
    Record<string, Record<string, (string | Partial<MockEntry>)[]>>
  >,
): MockFixtures {
  const entries: MockEntry[] = [];
  let n = 0;
  const id = () => `c-${++n}`;
  const T = "2026-01-01T00:00:00.000Z";
  const folder = (name: string, parentId: string | null) => {
    const f = {
      id: id(),
      name,
      mimeType: FOLDER_MIME,
      modifiedTime: T,
      parentId,
    };
    entries.push(f);
    return f.id;
  };
  const rootId = folder("root", null);
  for (const [an, recipes] of Object.entries(albums)) {
    const a = folder(an, rootId);
    for (const [rn, sets] of Object.entries(recipes)) {
      const r = folder(rn, a);
      for (const [sn, files] of Object.entries(sets)) {
        const p = sn === "" ? r : folder(sn, r);
        for (const f of files) {
          const spec = typeof f === "string" ? { name: f } : f;
          entries.push({
            id: id(),
            mimeType: "image/jpeg",
            modifiedTime: T,
            parentId: p,
            ...spec,
          } as MockEntry);
        }
      }
    }
  }
  return { rootId, entries };
}

describe("drive factory", () => {
  it("returns a singleton mock in mock mode and defaults the root", async () => {
    const a = getDrive(e);
    expect(getDrive(e)).toBe(a);
    expect(await getRootFolderId(e)).toBe(buildFixtures().rootId);
  });
  it("resetMockDrive drops the singleton and its mutations", async () => {
    const a = getDrive(e) as MockDrive;
    const root = buildFixtures().rootId;
    a.addFile(root, { name: "zzz-folder", mimeType: FOLDER_MIME });
    resetMockDrive();
    const b = getDrive(e);
    expect(b).not.toBe(a);
    expect((await b.listChildren(root)).map((f) => f.name)).not.toContain(
      "zzz-folder",
    );
  });
  it("uses the settings root when present", async () => {
    await setRoot("abc");
    expect(await getRootFolderId(e)).toBe("abc");
  });
  it("no root outside mock mode", async () => {
    expect(
      await getRootFolderId({ ...e, DRIVE_MODE: "google" } as Env),
    ).toBeUndefined();
  });
});

describe("first sync on fixtures", () => {
  let drive: MockDrive;
  let result: Awaited<ReturnType<typeof runSync>>;
  beforeEach(async () => {
    drive = createMockDrive();
    await setRoot(buildFixtures().rootId);
    result = await runSync(e, { drive });
  });

  it("creates 3 galleries and the right photo counts", async () => {
    expect(result.galleries).toEqual({ created: 3, updated: 0, archived: 0 });
    const g = await galleryBy("2026-11-14-boda-ana-y-juan");
    const ps = await photosOf(g.id);
    const count = (s: string) => ps.filter((p) => p.setName === s).length;
    expect(count("Highlights")).toBe(3);
    expect(count("Ceremonia")).toBe(60);
    expect(count("Fiesta")).toBe(60);
    const s = await galleryBy("retrato-sofia");
    expect((await photosOf(s.id)).length).toBe(30);
    expect(result.photos.added).toBe(123 + 30 + 10);
    expect(result.subrequests).toBeGreaterThan(0);
    expect(result.subrequests).toBeLessThanOrEqual(40);
  });

  it("new galleries are draft-by-rule but published in mock mode", async () => {
    const g = await galleryBy("retrato-sofia");
    expect(g.status).toBe("published");
    expect(g.title).toBe("Retrato Sofía");
    expect(g.lastSyncedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(g.driveModifiedAt).toBeTruthy();
  });

  it("non-mock mode creates drafts", async () => {
    await db.delete(schema.galleries);
    await db.delete(schema.settings);
    await setRoot(buildFixtures().rootId);
    await runSync({ ...e, DRIVE_MODE: "google" } as Env, {
      drive: createMockDrive(),
    });
    expect((await galleryBy("retrato-sofia")).status).toBe("draft");
  });

  it("detects the watermark folder", async () => {
    expect((await galleryBy("retrato-sofia")).useWatermarkPreview).toBe(true);
    const b = await galleryBy("2026-11-14-boda-ana-y-juan");
    expect(b.useWatermarkPreview).toBe(false);
    const ps = await photosOf(b.id);
    expect(ps.every((p) => p.driveWmId === null)).toBe(true);
    const s = await photosOf((await galleryBy("retrato-sofia")).id);
    expect(s.every((p) => p.driveWmId)).toBe(true);
  });

  it("stores variants, dims from high-res, and sorted order", async () => {
    const b = await galleryBy("2026-11-14-boda-ana-y-juan");
    const ps = await photosOf(b.id);
    for (const p of ps) {
      expect(
        p.driveHighresId && p.driveWebId && p.driveIgId && p.driveThumbId,
      ).toBeTruthy();
      expect(Math.max(p.width!, p.height!)).toBe(2048);
      expect(p.highresBytes).toBeGreaterThan(0);
      expect(p.takenAt).toBeTruthy();
    }
    const cer = ps
      .filter((p) => p.setName === "Ceremonia")
      .sort((a, b) => a.sort - b.sort);
    for (let i = 1; i < cer.length; i++) {
      const [x, y] = [cer[i - 1], cer[i]];
      expect(
        `${x.takenAt}\0${x.baseName}` <= `${y.takenAt}\0${y.baseName}`,
      ).toBe(true);
    }
    expect(new Set(ps.map((p) => p.sort)).size).toBe(ps.length);
  });

  it("Prueba Errores: issues of every type", async () => {
    const g = await galleryBy("prueba-errores");
    const issues = issuesOf(g);
    const has = (type: string, name: string) =>
      issues.some((i) => i.type === type && i.name === name);
    expect(has("missing_highres", "Huerfana_thumb")).toBe(true);
    expect(has("duplicate", "Gemela")).toBe(true);
    expect(has("not_jpeg", "notas.txt")).toBe(true);
    expect(has("unknown_folder", "raw")).toBe(true);
    expect(has("missing_web", "Solo_high")).toBe(true);
    expect(has("missing_thumb", "Solo_high")).toBe(true);
    expect(has("missing_web", "Ok_0001")).toBe(false);
    expect(issues.some((i) => i.name.includes("Atajo"))).toBe(false);
    expect(issues.some((i) => i.name.includes("Borrada"))).toBe(false);
    expect(issues.every((i) => "set" in i)).toBe(true);
  });

  it("Prueba Errores: duplicates collapse, names NFC, no metadata is null", async () => {
    const g = await galleryBy("prueba-errores");
    const ps = await photosOf(g.id);
    expect(ps.length).toBe(10);
    expect(
      ps.filter((p) => p.baseName.toLowerCase() === "duplicada"),
    ).toHaveLength(1);
    expect(ps.filter((p) => p.baseName === "Gemela")).toHaveLength(1);
    expect(ps.some((p) => p.baseName === "Caf\u00e9_nfd")).toBe(true);
    expect(ps.every((p) => p.baseName === p.baseName.normalize("NFC"))).toBe(
      true,
    );
    const sm = ps.find((p) => p.baseName === "Sin_metadata")!;
    expect(sm.width).toBeNull();
    expect(sm.height).toBeNull();
    expect(ps.some((p) => p.baseName === "Huerfana_thumb")).toBe(false);
    const solo = ps.find((p) => p.baseName === "Solo_high")!;
    expect(solo.driveWebId).toBeNull();
    expect(solo.driveThumbId).toBeNull();
    expect(solo.setName).toBe("Highlights");
  });

  it("idempotent: forced second run changes nothing", async () => {
    const r = await runSync(e, { drive, force: true });
    expect(r.photos).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(r.galleries).toEqual({ created: 0, updated: 0, archived: 0 });
  });

  it("unchanged token: skipped; after a change it syncs", async () => {
    const r = await runSync(e, { drive });
    expect(r.skipped).toBe("unchanged");
    expect(r.photos.added).toBe(0);
    const hr = await walk(
      drive,
      buildFixtures().rootId,
      "Retrato Sofía",
      "high-res",
    );
    drive.addFile(hr, { name: "Nueva.jpg", width: 2048, height: 1365 });
    const r2 = await runSync(e, { drive });
    expect(r2.skipped).toBeUndefined();
    expect(r2.photos.added).toBe(1);
  });

  it("add / rename / remove files then sync", async () => {
    const root = buildFixtures().rootId;
    const hr = await walk(drive, root, "Retrato Sofía", "high-res");
    const web = await walk(drive, root, "Retrato Sofía", "web");
    const added = drive.addFile(hr, {
      name: "Extra.jpg",
      width: 1365,
      height: 2048,
    });
    drive.addFile(web, { name: "Extra.jpg", width: 800, height: 1200 });
    let r = await runSync(e, { drive });
    expect(r.photos).toEqual({ added: 1, updated: 0, removed: 0 });
    const g = await galleryBy("retrato-sofia");
    const extra = (await photosOf(g.id)).find((p) => p.baseName === "Extra")!;
    expect(extra.driveHighresId).toBe(added.id);
    expect(extra.driveWebId).toBeTruthy();
    expect(extra.width).toBe(1365);
    expect(extra.sort).toBeGreaterThan(30 - 1);

    // rename = one missing (deleted after grace) + one added
    drive.renameFile(added.id, "Extra2.JPG");
    r = await runSync(e, { drive });
    expect(r.photos.added).toBe(1);
    expect(r.photos.removed).toBe(0);
    r = await runSync(e, { drive, force: true, now: later() });
    expect(r.photos.removed).toBe(1);

    // remove + R2 cleanup (first sighting marks, a later run deletes)
    const p2 = (await photosOf(g.id)).find((p) => p.baseName === "Extra2")!;
    await env.CACHE.put(`${p2.id}/thumb`, "x");
    await env.CACHE.put(`${p2.id}/view-lg`, "y");
    await env.CACHE.put(`${p2.id}x/thumb`, "keep");
    drive.removeFile(added.id);
    r = await runSync(e, { drive });
    expect(r.photos.removed).toBe(0);
    expect((await photosOf(g.id)).length).toBe(31);
    r = await runSync(e, { drive, force: true, now: later() });
    expect(r.photos.removed).toBe(1);
    expect(
      (await env.CACHE.list({ prefix: `${p2.id}/` })).objects,
    ).toHaveLength(0);
    expect(await env.CACHE.get(`${p2.id}x/thumb`)).not.toBeNull();
    expect((await photosOf(g.id)).length).toBe(30);
  });

  it("updates a photo when its files change", async () => {
    const root = buildFixtures().rootId;
    const th = await walk(drive, root, "Retrato Sofía", "thumb");
    const f = (await drive.listChildren(th))[0];
    drive.removeFile(f.id);
    const r = await runSync(e, { drive });
    expect(r.photos).toEqual({ added: 0, updated: 1, removed: 0 });
  });

  it("stores each variant's modifiedTime; a change in any variant counts as updated", async () => {
    const g = await galleryBy("2026-11-14-boda-ana-y-juan");
    const before = (await photosOf(g.id))[0];
    const vv = JSON.parse(before.variantVersions!);
    expect(Object.keys(vv).sort()).toEqual([
      "highres",
      "ig",
      "thumb",
      "web",
      "wm",
    ]);
    expect(typeof vv.highres).toBe("string");
    expect(vv.wm).toBeNull();
    // Same file id, same base name, new modifiedTime (in-place re-export).
    const target = await drive.getMeta(before.driveThumbId!);
    drive.renameFile(target.id, target.name.replace(/\.jpg$/i, ".jpeg"));
    const r = await runSync(e, { drive });
    expect(r.photos.updated).toBe(1);
    const after = (await photosOf(g.id)).find((p) => p.id === before.id)!;
    expect(after.driveThumbId).toBe(before.driveThumbId);
    expect(JSON.parse(after.variantVersions!).thumb).not.toBe(vv.thumb);
    expect(JSON.parse(after.variantVersions!).highres).toBe(vv.highres);
  });

  it("album trashed -> archived, rows kept", async () => {
    const root = buildFixtures().rootId;
    const album = await findChild(drive, root, "Retrato Sofía");
    drive.trashFile(album.id);
    const r = await runSync(e, { drive });
    expect(r.galleries.archived).toBe(0);
    let g = await galleryBy("retrato-sofia");
    expect(g.status).toBe("published");
    expect(g.folderMissingSince).not.toBeNull();
    const r1 = await runSync(e, { drive, force: true, now: later() });
    expect(r1.galleries.archived).toBe(1);
    g = await galleryBy("retrato-sofia");
    expect(g.status).toBe("archived");
    expect(g.archivedPrevStatus).toBe("published");
    expect((await photosOf(g.id)).length).toBe(30);
    const r2 = await runSync(e, { drive, force: true, now: later() });
    expect(r2.galleries.archived).toBe(0);
  });

  it("existing galleries keep slug/title/status when folder is renamed", async () => {
    const root = buildFixtures().rootId;
    const album = await findChild(drive, root, "Retrato Sofía");
    await db
      .update(schema.galleries)
      .set({ title: "Custom", status: "draft" })
      .where(eq(schema.galleries.slug, "retrato-sofia"));
    drive.renameFile(album.id, "Otro Nombre");
    const r = await runSync(e, { drive });
    expect(r.galleries.created).toBe(0);
    const g = await galleryBy("retrato-sofia");
    expect(g.title).toBe("Custom");
    expect(g.status).toBe("draft");
  });
});

describe("lock, budget, token", () => {
  it("held lock -> skipped locked, untouched", async () => {
    await setRoot(buildFixtures().rootId);
    await db.insert(schema.settings).values({
      key: "sync_lock",
      value: `${new Date(Date.now() + 60_000).toISOString()}|x`,
    });
    const r = await runSync(e, { drive: createMockDrive() });
    expect(r.skipped).toBe("locked");
    expect(await db.select().from(schema.galleries)).toHaveLength(0);
    const [l] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "sync_lock"));
    expect(l).toBeDefined();
  });

  it("expired lock is taken over and the lock released after", async () => {
    await setRoot(buildFixtures().rootId);
    await db.insert(schema.settings).values({
      key: "sync_lock",
      value: `${new Date(Date.now() - 60_000).toISOString()}|x`,
    });
    const r = await runSync(e, { drive: createMockDrive() });
    expect(r.skipped).toBeUndefined();
    const l = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "sync_lock"));
    expect(l).toHaveLength(0);
  });

  it("lock is released when the drive throws", async () => {
    await setRoot("nope");
    await expect(runSync(e, { drive: createMockDrive() })).rejects.toThrow();
    const l = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "sync_lock"));
    expect(l).toHaveLength(0);
  });

  it("no root configured -> skipped no_root", async () => {
    const r = await runSync({ ...e, DRIVE_MODE: "google" } as Env, {
      drive: createMockDrive(),
    });
    expect(r.skipped).toBe("no_root");
  });

  it("budget exceeded -> error, DB unchanged, token not stored", async () => {
    await setRoot(buildFixtures().rootId);
    await expect(
      runSync(e, { drive: createMockDrive(), budget: 2 }),
    ).rejects.toThrow(/budget/i);
    expect(await db.select().from(schema.galleries)).toHaveLength(0);
    expect(await db.select().from(schema.photos)).toHaveLength(0);
    const s = await db.select().from(schema.settings);
    expect(s.map((x) => x.key)).toEqual(["drive_root_id"]);
  });

  it("token is stored after success", async () => {
    await setRoot(buildFixtures().rootId);
    await runSync(e, { drive: createMockDrive() });
    const [t] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "drive_changes_token"));
    expect(t.value).toBe("1");
  });
});

describe("determinism", () => {
  async function dump() {
    const gs = await db.select().from(schema.galleries);
    const out: unknown[] = [];
    for (const g of gs.sort((a, b) => a.slug.localeCompare(b.slug))) {
      const ps = await photosOf(g.id);
      out.push({
        slug: g.slug,
        title: g.title,
        issues: g.syncIssuesJson,
        wm: g.useWatermarkPreview,
        photos: ps
          .map(({ id: _i, galleryId: _g, ...p }) => p)
          .sort((a, b) =>
            `${a.setName}${a.sort}`.localeCompare(`${b.setName}${b.sort}`),
          ),
      });
    }
    return out;
  }
  it("shuffled listing order gives an identical DB", async () => {
    await setRoot(buildFixtures().rootId);
    await runSync(e, { drive: createMockDrive() });
    const plain = await dump();
    await db.delete(schema.galleries);
    await db.delete(schema.settings);
    await setRoot(buildFixtures().rootId);
    await runSync(e, {
      drive: createMockDrive(undefined, { shuffleSeed: 42 }),
    });
    expect(await dump()).toEqual(plain);
  });
});

describe("slugs and rules on custom trees", () => {
  const hr = (...files: string[]) => ({ "high-res": { "": files } });

  it("accents, reserved, duplicates, empty, long", async () => {
    const long = "x".repeat(80);
    const fx = tree({
      "Café Ñandú!!": hr("a.jpg"),
      admin: hr("a.jpg"),
      Api: hr("a.jpg"),
      Boda: hr("a.jpg"),
      boda: hr("a.jpg"),
      "¡¡¡": hr("a.jpg"),
      "---": hr("a.jpg"),
      [long]: hr("a.jpg"),
    });
    await setRoot(fx.rootId);
    await runSync(e, { drive: createMockDrive(fx) });
    const slugs = (await db.select().from(schema.galleries))
      .map((g) => g.slug)
      .sort();
    expect(slugs).toContain("cafe-nandu");
    expect(slugs).toContain("admin-2");
    expect(slugs).toContain("api-2");
    expect(slugs).toContain("boda");
    expect(slugs).toContain("boda-2");
    expect(slugs).toContain("galeria");
    expect(slugs).toContain("galeria-2");
    expect(slugs).toContain("x".repeat(60));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("slug collides with an existing slug (case-insensitive)", async () => {
    await db.insert(schema.galleries).values({
      driveFolderId: "other",
      slug: "BODA",
      title: "t",
    });
    const fx = tree({ Boda: hr("a.jpg") });
    await setRoot(fx.rootId);
    await runSync(e, { drive: createMockDrive(fx) });
    expect((await galleryBy("boda-2"))?.title).toBe("Boda");
  });

  it("jpeg detection by mime or extension; stray files and sets", async () => {
    const fx = tree({
      A: {
        "High-Res ": {
          "": [
            "one.JPEG",
            { name: "two", mimeType: "image/jpeg" },
            { name: "three.jpg", mimeType: "application/octet-stream" },
            { name: "four.png", mimeType: "image/png" },
          ],
          " Día 1 ": ["x.jpg"],
        },
        WEB: { "": ["ONE.jpg"], " Día 1 ": ["X.jpg"] },
      },
    });
    // a stray file in the album folder
    const album = fx.entries.find((x) => x.name === "A")!;
    fx.entries.push({
      id: "stray",
      name: "loose.jpg",
      mimeType: "image/jpeg",
      modifiedTime: "2026-01-01T00:00:00.000Z",
      parentId: album.id,
    });
    await setRoot(fx.rootId);
    await runSync(e, { drive: createMockDrive(fx) });
    const g = await galleryBy("a");
    const ps = await photosOf(g.id);
    expect(ps.map((p) => `${p.setName}/${p.baseName}`).sort()).toEqual(
      [
        "Día 1/x",
        "Highlights/one",
        "Highlights/three",
        "Highlights/two",
      ].sort(),
    );
    const one = ps.find((p) => p.baseName === "one")!;
    expect(one.driveWebId).toBeTruthy();
    expect(ps.find((p) => p.baseName === "x")!.driveWebId).toBeTruthy();
    const issues = issuesOf(g);
    expect(
      issues.some((i) => i.type === "not_jpeg" && i.name === "four.png"),
    ).toBe(true);
    expect(
      issues.some((i) => i.type === "stray_file" && i.name === "loose.jpg"),
    ).toBe(true);
  });

  it("duplicate keeps the newest modifiedTime", async () => {
    const fx = tree({
      A: hr(
        { name: "p.jpg", id: "old", modifiedTime: "2026-01-01T00:00:00.000Z" },
        { name: "P.JPG", id: "new", modifiedTime: "2026-02-01T00:00:00.000Z" },
      ) as never,
    });
    await setRoot(fx.rootId);
    await runSync(e, { drive: createMockDrive(fx) });
    const ps = await photosOf((await galleryBy("a")).id);
    expect(ps).toHaveLength(1);
    expect(ps[0].driveHighresId).toBe("new");
  });

  it("falls back to another variant's aspect for dimensions", async () => {
    const fx = tree({
      A: {
        "high-res": { "": ["p.jpg"] },
        web: { "": [{ name: "p.jpg", width: 1200, height: 800 }] },
      },
    });
    await setRoot(fx.rootId);
    await runSync(e, { drive: createMockDrive(fx) });
    const [p] = await photosOf((await galleryBy("a")).id);
    expect(p.width).toBe(2048);
    expect(p.height).toBe(1365);
  });

  it("existing sort order is kept; new photos go after", async () => {
    const fx = tree({ A: hr("b.jpg", "c.jpg") });
    const d = createMockDrive(fx);
    await setRoot(fx.rootId);
    await runSync(e, { drive: d });
    const g = await galleryBy("a");
    await db
      .update(schema.photos)
      .set({ sort: 50 })
      .where(eq(schema.photos.baseName, "c"));
    const folder = fx.entries.find((x) => x.name === "high-res")!;
    d.addFile(folder.id, { name: "a.jpg" });
    await runSync(e, { drive: d });
    const ps = await photosOf(g.id);
    expect(ps.find((p) => p.baseName === "c")!.sort).toBe(50);
    expect(ps.find((p) => p.baseName === "a")!.sort).toBe(51);
  });
});

describe("POST /api/admin/sync", () => {
  const url = "http://localhost/api/admin/sync";
  it("401 for non-admin", async () => {
    const r = await handleSync(
      new Request(url, { method: "POST" }),
      { ...e, ALLOW_DEV_ADMIN: "0" } as Env,
      createMockDrive(),
    ).catch((x) => x as Response);
    expect(r.status).toBe(401);
  });
  it("405 for GET", async () => {
    const r = await handleSync(new Request(url), e, createMockDrive());
    expect(r.status).toBe(405);
    expect(r.headers.get("Allow")).toBe("POST");
  });
  it("forces a sync and returns JSON without drive ids", async () => {
    await setRoot(buildFixtures().rootId);
    const d = createMockDrive();
    const r = await handleSync(new Request(url, { method: "POST" }), e, d);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
    const text = await r.text();
    const body = JSON.parse(text);
    expect(body.photos.added).toBe(163);
    expect(text).not.toMatch(/mock-(dir|img)-/);
    const r2 = await handleSync(new Request(url, { method: "POST" }), e, d);
    expect((await r2.json<{ photos: { added: number } }>()).photos.added).toBe(
      0,
    );
  });
  it("500 with a generic error on budget failure", async () => {
    await setRoot("nope");
    const r = await handleSync(
      new Request(url, { method: "POST" }),
      e,
      createMockDrive(),
    );
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("nope");
  });
});

describe("sync safety", () => {
  const hideAlbum = (inner: MockDrive, name: string, hidden: () => boolean) => {
    const d: DriveClient = {
      ...inner,
      subrequests: () => inner.subrequests(),
      getMeta: (id) => inner.getMeta(id),
      listChildrenMany: async (ids) => {
        const r = await inner.listChildrenMany(ids);
        if (hidden() && ids.length === 1 && ids[0] === buildFixtures().rootId)
          r.set(
            ids[0],
            r.get(ids[0])!.filter((f) => f.name !== name),
          );
        return r;
      },
    };
    return d;
  };

  beforeEach(async () => {
    await db.delete(schema.galleries);
    await db.delete(schema.settings);
  });

  it("missing folder: mark, archive after grace with prev status, restore when back", async () => {
    await setRoot(buildFixtures().rootId);
    const inner = createMockDrive();
    let hidden = false;
    const d = hideAlbum(inner, "Retrato Sofía", () => hidden);
    await runSync(e, { drive: d });
    await db
      .update(schema.galleries)
      .set({ status: "draft" })
      .where(eq(schema.galleries.slug, "retrato-sofia"));
    hidden = true;
    await runSync(e, { drive: d, force: true });
    let g = await galleryBy("retrato-sofia");
    expect(g.status).toBe("draft");
    expect(g.folderMissingSince).not.toBeNull();
    await runSync(e, { drive: d, force: true, now: later() });
    g = await galleryBy("retrato-sofia");
    expect([g.status, g.archivedPrevStatus]).toEqual(["archived", "draft"]);
    hidden = false;
    await runSync(e, { drive: d, force: true, now: later() });
    g = await galleryBy("retrato-sofia");
    expect([g.status, g.archivedPrevStatus, g.folderMissingSince]).toEqual([
      "draft",
      null,
      null,
    ]);
  });

  it("unchanged token still lets a pending grace period mature", async () => {
    await setRoot(buildFixtures().rootId);
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const album = await findChild(d, buildFixtures().rootId, "Retrato Sofía");
    d.trashFile(album.id);
    await runSync(e, { drive: d });
    const r = await runSync(e, { drive: d, now: later() });
    expect(r.skipped).toBeUndefined();
    expect(r.galleries.archived).toBe(1);
  });

  it("a returning photo clears missing_since", async () => {
    await setRoot(buildFixtures().rootId);
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const g = await galleryBy("retrato-sofia");
    const hr = await walk(
      d,
      buildFixtures().rootId,
      "Retrato Sofía",
      "high-res",
    );
    const f = (await d.listChildren(hr))[0];
    d.removeFile(f.id);
    await runSync(e, { drive: d, force: true });
    expect((await photosOf(g.id)).filter((p) => p.missingSince)).toHaveLength(
      1,
    );
    d.addFile(hr, { name: f.name, width: f.width, height: f.height });
    await runSync(e, { drive: d, force: true });
    expect((await photosOf(g.id)).filter((p) => p.missingSince)).toHaveLength(
      0,
    );
  });

  it("empty root with galleries: aborted, nothing written, token kept", async () => {
    await setRoot(buildFixtures().rootId);
    const inner = createMockDrive();
    let blind = false;
    const d: DriveClient = {
      ...inner,
      subrequests: () => inner.subrequests(),
      getMeta: (id) => inner.getMeta(id),
      listChildrenMany: async (ids) => {
        const r = await inner.listChildrenMany(ids);
        if (blind && ids.length === 1) r.set(ids[0], []);
        return r;
      },
    };
    await runSync(e, { drive: d });
    blind = true;
    const r = await runSync(e, { drive: d, force: true, now: later() });
    expect(r.skipped).toBe("empty_root");
    const gs = await db.select().from(schema.galleries);
    expect(
      gs.every((g) => g.status === "published" && !g.folderMissingSince),
    ).toBe(true);
  });

  it("listChanges 400/404 falls back to a rescan; 500 is rethrown", async () => {
    await setRoot(buildFixtures().rootId);
    const inner = createMockDrive();
    await runSync(e, { drive: inner });
    for (const status of [400, 404]) {
      const d: DriveClient = {
        ...inner,
        subrequests: () => inner.subrequests(),
        getMeta: (id) => inner.getMeta(id),
        listChildrenMany: (ids) => inner.listChildrenMany(ids),
        getStartPageToken: () => inner.getStartPageToken(),
        listChanges: async () => {
          throw new DriveError(status, "x");
        },
      };
      const r = await runSync(e, { drive: d });
      expect(r.skipped).toBeUndefined();
    }
    const bad: DriveClient = {
      ...inner,
      subrequests: () => inner.subrequests(),
      listChanges: async () => {
        throw new DriveError(500, "x");
      },
    };
    await expect(runSync(e, { drive: bad })).rejects.toThrow();
  });

  it("highres_empty issue when the high-res folder has no JPEGs", async () => {
    await setRoot(buildFixtures().rootId);
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const hr = await walk(
      d,
      buildFixtures().rootId,
      "Retrato Sofía",
      "high-res",
    );
    for (const f of await d.listChildren(hr)) d.removeFile(f.id);
    await runSync(e, { drive: d, force: true, now: later() });
    const g = await galleryBy("retrato-sofia");
    expect(
      JSON.parse(g.syncIssuesJson!).map((i: { type: string }) => i.type),
    ).toContain("highres_empty");
    expect((await photosOf(g.id)).filter((p) => p.missingSince)).toHaveLength(
      0,
    );
  });

  it("issues JSON is capped at 200 entries plus a truncated summary", async () => {
    await setRoot(buildFixtures().rootId);
    const T = "2026-01-01T00:00:00.000Z";
    const mk = (
      id: string,
      name: string,
      parentId: string,
      mimeType = "image/jpeg",
    ) => ({ id, name, mimeType, modifiedTime: T, parentId }) as MockEntry;
    const entries: MockEntry[] = [
      mk(buildFixtures().rootId, "root", "", FOLDER_MIME),
      mk("a", "A", buildFixtures().rootId, FOLDER_MIME),
      mk("h", "high-res", "a", FOLDER_MIME),
      mk("t", "thumb", "a", FOLDER_MIME),
    ];
    entries[0].parentId = null;
    for (let i = 0; i < 250; i++) entries.push(mk(`t${i}`, `O${i}.jpg`, "t"));
    await runSync(e, {
      drive: createMockDrive({ rootId: buildFixtures().rootId, entries }),
    });
    const issues = JSON.parse((await galleryBy("a")).syncIssuesJson!);
    expect(issues).toHaveLength(201);
    expect(issues[200]).toEqual({ truncated: 50 });
  });

  it("the default budget is 45 external calls", async () => {
    await setRoot(buildFixtures().rootId);
    const inner = createMockDrive();
    let extra = 0;
    const d: DriveClient = {
      ...inner,
      subrequests: () => inner.subrequests() + extra,
      getMeta: (id) => inner.getMeta(id),
      listChildrenMany: (ids) => inner.listChildrenMany(ids),
      getStartPageToken: async () => {
        extra += 44; // e.g. retries + OAuth refresh
        return inner.getStartPageToken();
      },
    };
    await expect(runSync(e, { drive: d, force: true })).rejects.toThrow(
      /budget/i,
    );
    expect(await db.select().from(schema.galleries)).toHaveLength(0);
  });

  it("scheduled sync records a generic last error, rethrows, and clears on success", async () => {
    await setRoot(buildFixtures().rootId);
    const bad: DriveClient = {
      ...createMockDrive(),
      getMeta: async () => {
        throw new Error("secret-id-123");
      },
    };
    await expect(runScheduledSync(e, bad)).rejects.toThrow();
    const [row] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "sync_last_error"));
    expect(JSON.parse(row.value).message).toBe("sync failed");
    expect(row.value).not.toContain("secret");
    await runScheduledSync(e, createMockDrive());
    expect(
      await db
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.key, "sync_last_error")),
    ).toHaveLength(0);
  });

  it("sync cleans exactly the three known R2 keys in one delete call", async () => {
    await setRoot(buildFixtures().rootId);
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const g = await galleryBy("retrato-sofia");
    const p = (await photosOf(g.id))[0];
    for (const k of ["thumb", "view-sm", "view-lg"])
      await env.CACHE.put(`${p.id}/${k}`, "x");
    d.removeFile(p.driveHighresId);
    await runSync(e, { drive: d, force: true });
    await runSync(e, { drive: d, force: true, now: later() });
    expect((await env.CACHE.list({ prefix: `${p.id}/` })).objects).toHaveLength(
      0,
    );
  });
});

describe("review fixes", () => {
  it("hard-delete clears galleries.cover_photo_id when it points at a deleted photo", async () => {
    await setRoot(buildFixtures().rootId);
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const g = await galleryBy("retrato-sofia");
    const [victim, keeper] = await photosOf(g.id);
    await db
      .update(schema.galleries)
      .set({ coverPhotoId: victim.id })
      .where(eq(schema.galleries.id, g.id));
    d.removeFile(victim.driveHighresId);
    await runSync(e, { drive: d });
    expect((await galleryBy("retrato-sofia")).coverPhotoId).toBe(victim.id);
    const r = await runSync(e, { drive: d, force: true, now: later() });
    expect(r.photos.removed).toBe(1);
    expect((await galleryBy("retrato-sofia")).coverPhotoId).toBeNull();
    expect((await photosOf(g.id)).some((p) => p.id === keeper.id)).toBe(true);
  });

  it("sync_lock is `<second-precision iso>|<uuid>` while running", async () => {
    await setRoot(buildFixtures().rootId);
    const inner = createMockDrive();
    let seen: string | undefined;
    const d: DriveClient = {
      ...inner,
      subrequests: () => inner.subrequests(),
      getMeta: async (id) => {
        const [l] = await db
          .select()
          .from(schema.settings)
          .where(eq(schema.settings.key, "sync_lock"));
        seen = l?.value;
        return inner.getMeta(id);
      },
      listChildrenMany: (ids) => inner.listChildrenMany(ids),
      getStartPageToken: () => inner.getStartPageToken(),
    };
    await runSync(e, { drive: d });
    expect(seen).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\|[0-9a-f]{8}-[0-9a-f-]{27}$/,
    );
  });

  const lastError = async () =>
    (
      await db
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.key, "sync_last_error"))
    )[0];

  it("scheduled sync with no root records a generic sync_last_error", async () => {
    await runScheduledSync(
      { ...e, DRIVE_MODE: "google" } as Env,
      createMockDrive(),
    );
    const row = await lastError();
    expect(row).toBeDefined();
    const v = JSON.parse(row.value) as { at: string; message: string };
    expect(v.message).toBe("no root folder configured");
    expect(v.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it("scheduled sync with an empty root listing records sync_last_error", async () => {
    await setRoot(buildFixtures().rootId);
    const inner = createMockDrive();
    await runSync(e, { drive: inner });
    const blind: DriveClient = {
      ...inner,
      subrequests: () => inner.subrequests(),
      getMeta: (id) => inner.getMeta(id),
      getStartPageToken: () => inner.getStartPageToken(),
      listChanges: (t) => inner.listChanges(t),
      listChildrenMany: async (ids) => {
        const r = await inner.listChildrenMany(ids);
        if (ids.length === 1) r.set(ids[0], []);
        return r;
      },
    };
    // force a rescan: drop the stored token
    await db
      .delete(schema.settings)
      .where(eq(schema.settings.key, "drive_changes_token"));
    const r = await runScheduledSync(e, blind);
    expect(r.skipped).toBe("empty_root");
    expect(JSON.parse((await lastError()).value).message).toBe(
      "root folder listed empty",
    );
  });
});
