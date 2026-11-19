import { clearCache } from "./support/cache";
import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { galleryMeta } from "../app/lib/og";
import { loadGallery } from "../app/lib/server/gallery";
import {
  handleBulk,
  handleDownloadTokens,
  serveDownload,
} from "../app/lib/server/downloads";
import {
  imageVersionToken,
  resolveSource,
  serveImage,
} from "../app/lib/server/images";
import type { DriveClient } from "../app/lib/server/drive-types";
import { expectedWarmKey, warmBatch } from "../app/lib/server/warm";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "google" } as Env;
const G = "aaaaaaaa-0000-0000-0000-00000000000a";
const P = "pppppppp-0000-0000-0000-000000000001";
const BASE = "https://session.test";
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);

beforeAll(async () => {
  await migrateDb();
});

const VERSIONS = JSON.stringify({
  highres: "2026-01-01T00:00:01Z",
  web: "2026-01-01T00:00:02Z",
  ig: "2026-01-01T00:00:02Z",
  thumb: "2026-01-01T00:00:03Z",
  wm: "2026-01-01T00:00:04Z",
  thumbWm: "2026-01-01T00:00:05Z",
});
const FULL = {
  id: P,
  driveHighresId: "HI",
  driveWebId: "WEB",
  driveIgId: "IG",
  driveThumbId: "TH",
  driveWmId: "WM",
  driveThumbWmId: "TWM",
  variantVersions: VERSIONS,
};

function fakeDrive() {
  const calls: string[] = [];
  let n = 0;
  const drive = {
    subrequests: () => n,
    async streamFile(id: string) {
      calls.push(id);
      n++;
      return new Response(JPEG.slice(), {
        headers: { "Content-Length": String(JPEG.length) },
      });
    },
  } as unknown as DriveClient;
  return { drive, calls };
}

async function addGallery(over: Record<string, unknown> = {}) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "pub",
    title: "T",
    status: "published",
    requireEmail: false,
    ...over,
  });
}
async function addPhoto(over: Record<string, unknown> = {}, id = P) {
  await db.insert(schema.photos).values({
    id,
    galleryId: G,
    baseName: "p-" + id,
    driveHighresId: "HI",
    driveWebId: "WEB",
    driveIgId: "IG",
    driveThumbId: "TH",
    driveWmId: "WM",
    driveThumbWmId: "TWM",
    variantVersions: VERSIONS,
    width: 3000,
    height: 2000,
    ...over,
  });
}
beforeEach(async () => {
  await resetTables(
    "downloads",
    "visitors",
    "rate_limits",
    "photos",
    "galleries",
    "settings",
  );
  await clearCache();
});

async function img(
  variant: string,
  o: { admin?: boolean; photoId?: string; drive?: DriveClient } = {},
) {
  const pending: Promise<unknown>[] = [];
  const f = fakeDrive();
  const res = await serveImage(
    new Request(`${BASE}/img/${o.photoId ?? P}/${variant}`),
    { photoId: o.photoId ?? P, variant },
    e,
    { waitUntil: (p: Promise<unknown>) => void pending.push(p) },
    { drive: o.drive ?? f.drive },
    { admin: o.admin },
  );
  await Promise.all(pending);
  return { res, calls: f.calls };
}

describe("resolveSource per mode (proofing = true)", () => {
  const row = FULL;
  it("delivery: clean thumb / web / high-res, never wm files", () => {
    expect(resolveSource(row, false, "thumb")).toMatchObject({
      fileId: "TH",
      watermark: false,
    });
    expect(resolveSource(row, false, "view-sm")?.fileId).toBe("WEB");
    expect(resolveSource(row, false, "view-lg")?.fileId).toBe("HI");
  });
  it("proofing: thumb -> thumb-wm, view-* -> preview-wm, all flagged watermark", () => {
    expect(resolveSource(row, true, "thumb")).toMatchObject({
      fileId: "TWM",
      watermark: true,
      version: "2026-01-01T00:00:05Z",
    });
    expect(resolveSource(row, true, "view-sm")).toMatchObject({
      fileId: "WM",
      watermark: true,
    });
    expect(resolveSource(row, true, "view-lg")?.fileId).toBe("WM");
  });
  it("proofing thumb falls back to preview-wm, NEVER to a clean thumb/web/high-res", () => {
    const noTwm = { ...row, driveThumbWmId: null };
    expect(resolveSource(noTwm, true, "thumb")?.fileId).toBe("WM");
    const none = { ...noTwm, driveWmId: null };
    expect(resolveSource(none, true, "thumb")).toBeNull();
    expect(resolveSource(none, true, "view-sm")).toBeNull();
    expect(resolveSource(none, true, "view-lg")).toBeNull();
  });
  it("proofing with only a thumb-wm: thumb works, views are null", () => {
    const only = { ...row, driveWmId: null };
    expect(resolveSource(only, true, "thumb")?.fileId).toBe("TWM");
    expect(resolveSource(only, true, "view-sm")).toBeNull();
  });
});

describe("serveImage per mode", () => {
  it("proofing: thumb is the thumb-wm file; views are preview-wm", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto();
    expect((await img("thumb")).calls).toEqual(["TWM"]);
    expect((await img("view-sm")).calls).toEqual(["WM"]);
    expect((await img("view-lg")).calls).toEqual(["WM"]);
    expect((await env.CACHE.head(`${P}/thumb`))?.customMetadata).toMatchObject({
      fileId: "TWM",
      wm: "1",
    });
  });
  it("proofing: thumb falls back to preview-wm when there is no thumb-wm", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto({ driveThumbWmId: null });
    expect((await img("thumb")).calls).toEqual(["WM"]);
  });
  it("proofing without preview-wm: every public variant is 404 and Drive is untouched", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto({ driveWmId: null, driveThumbWmId: null });
    for (const v of ["thumb", "view-sm", "view-lg"]) {
      const { res, calls } = await img(v);
      expect(res.status).toBe(404);
      expect(calls).toEqual([]);
    }
  });
  it("delivery: clean files, wm files never served", async () => {
    await addGallery({ mode: "delivery" });
    await addPhoto();
    expect((await img("thumb")).calls).toEqual(["TH"]);
    expect((await img("view-sm")).calls).toEqual(["WEB"]);
    expect((await img("view-lg")).calls).toEqual(["HI"]);
  });
  it("admin sees clean previews of a proofing gallery and never touches the shared R2 keys", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto();
    const t = await img("thumb", { admin: true });
    expect(t.res.status).toBe(200);
    expect(t.calls).toEqual(["TH"]);
    const v = await img("view-sm", { admin: true });
    expect(v.calls).toEqual(["WEB"]);
    expect(await env.CACHE.head(`${P}/thumb`)).toBeNull();
    expect(await env.CACHE.head(`${P}/view-sm`)).toBeNull();
  });
  it("admin on a proofing gallery with no preview-wm still gets clean previews", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto({ driveWmId: null, driveThumbWmId: null });
    expect((await img("thumb", { admin: true })).res.status).toBe(200);
  });
  it("a mode switch invalidates R2 (wm flag / file id differ)", async () => {
    await addGallery({ mode: "delivery" });
    await addPhoto();
    await img("thumb");
    await db.update(schema.galleries).set({ mode: "proofing" });
    const r = await img("thumb");
    expect(r.calls).toEqual(["TWM"]);
  });
});

describe("version token follows the mode and thumb-wm", () => {
  it("differs between proofing and delivery, and when thumb-wm changes", async () => {
    await addGallery();
    await addPhoto();
    const [p] = await db.select().from(schema.photos);
    const a = await imageVersionToken(e, p, false);
    const b = await imageVersionToken(e, p, true);
    expect(a).not.toBe(b);
    const c = await imageVersionToken(
      e,
      {
        ...p,
        variantVersions: VERSIONS.replace("00:05Z", "00:09Z"),
      },
      true,
    );
    expect(c).not.toBe(b);
  });
});

describe("loadGallery payload", () => {
  const req = () =>
    new Request(`${BASE}/pub`, { headers: { "Sec-Fetch-Mode": "navigate" } });
  it("proofing: mode exposed, every download flag false, no Drive ids", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto();
    const r = await loadGallery(req(), "pub", e);
    if (r.data.state !== "open") throw new Error("not open");
    expect(r.data.gallery.mode).toBe("proofing");
    expect(r.data.gallery).toMatchObject({
      allowBulk: false,
      allowHighres: false,
      allowWeb: false,
      allowIg: false,
    });
    expect(JSON.stringify(r.data)).not.toMatch(/TWM|"WM"|"TH"|"HI"/);
  });
  it("delivery: flags follow allow_* and mode is delivery", async () => {
    await addGallery({ mode: "delivery", allowIg: false });
    await addPhoto();
    const r = await loadGallery(req(), "pub", e);
    if (r.data.state !== "open") throw new Error("not open");
    expect(r.data.gallery.mode).toBe("delivery");
    expect(r.data.gallery.allowHighres).toBe(true);
    expect(r.data.gallery.allowIg).toBe(false);
  });
  it("og:image is the wm view-sm in proofing, absent when no photo has preview-wm", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto({ driveWmId: null }, "p-nowm");
    await addPhoto({}, "p-wm");
    const r = await loadGallery(req(), "pub", e);
    if (r.data.state !== "open") throw new Error("not open");
    expect(r.data.og?.coverId).toBe("p-wm");
    const tags = galleryMeta(r.data, {
      studio: "S",
      lang: "es",
      origin: "https://o.test",
    });
    expect(tags.find((t) => t.property === "og:image")?.content).toBe(
      "https://o.test/img/p-wm/view-sm",
    );
    await db.update(schema.photos).set({ driveWmId: null });
    const r2 = await loadGallery(req(), "pub", e);
    if (r2.data.state !== "open") throw new Error("not open");
    expect(r2.data.og?.coverId).toBeNull();
  });
});

describe("downloads in proofing", () => {
  const post = (path: string, body: unknown) =>
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "9.9.9.9",
      },
      body: JSON.stringify(body),
    });
  const issue = (body: unknown) =>
    handleDownloadTokens(post("/api/g/pub/download-tokens", body), "pub", env);

  it("token endpoint refuses with 403 proofing for every variant", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto();
    for (const variant of ["highres", "web", "ig"]) {
      const res = await issue({ photoIds: [P], variant });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "proofing" });
    }
  });
  it("bulk endpoint refuses with 403 proofing", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto();
    const res = await handleBulk(
      post("/api/g/pub/bulk", { scope: "all", variant: "highres" }),
      "pub",
      env,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "proofing" });
    expect((await db.select().from(schema.downloads)).length).toBe(0);
  });
  it("tokens issued in delivery stop working the moment the gallery goes to proofing", async () => {
    await addGallery({ mode: "delivery" });
    await addPhoto();
    const res = await issue({ photoIds: [P], variant: "highres" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tokens: { url: string }[] };
    const token = body.tokens[0].url.replace("/dl/", "");
    const { drive, calls } = fakeDrive();
    const dl = () =>
      serveDownload(
        new Request(`${BASE}/dl/${token}`, {
          headers: { "CF-Connecting-IP": "9.9.9.9" },
        }),
        token,
        e,
        { drive },
      );
    expect((await dl()).status).toBe(200);
    await db.update(schema.galleries).set({ mode: "proofing" });
    expect((await dl()).status).toBe(410);
    expect(calls).toEqual(["HI"]);
    // Switching back restores nothing by itself except the same still-valid token.
    await db.update(schema.galleries).set({ mode: "delivery" });
    expect((await dl()).status).toBe(200);
  });
});

describe("warm keys per mode", () => {
  it("proofing key resolves thumb-wm + preview-wm; delivery key resolves clean files", async () => {
    await addGallery();
    await addPhoto();
    const [p] = await db.select().from(schema.photos);
    const proof = await expectedWarmKey(p, true);
    const deliv = await expectedWarmKey(p, false);
    expect(proof).not.toBe(deliv);
    const bumped = await expectedWarmKey(
      { ...p, variantVersions: VERSIONS.replace("00:05Z", "00:09Z") },
      true,
    );
    expect(bumped).not.toBe(proof);
    // thumb-wm changes do not matter in delivery.
    expect(
      await expectedWarmKey(
        { ...p, variantVersions: VERSIONS.replace("00:05Z", "00:09Z") },
        false,
      ),
    ).toBe(deliv);
  });
  it("proofing warms thumb-wm (or preview-wm fallback) and view-sm from preview-wm, never view-lg", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto({}, "a");
    await addPhoto(
      { driveThumbWmId: null, driveWmId: "WM-b", driveWebId: "WEB-b" },
      "b",
    );
    const { drive, calls } = fakeDrive();
    const r = await warmBatch(e, { drive });
    expect(r.warmed).toBe(2);
    expect(calls.sort()).toEqual(["TWM", "WM", "WM-b", "WM-b"]);
    expect(await env.CACHE.head("a/view-lg")).toBeNull();
    expect((await env.CACHE.head("a/view-sm"))?.customMetadata?.wm).toBe("1");
    expect((await env.CACHE.head("a/thumb"))?.customMetadata?.wm).toBe("1");
  });
  it("a proofing photo without preview-wm cannot be warmed (marker stays)", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto({ driveWmId: null, driveThumbWmId: null });
    const { drive, calls } = fakeDrive();
    const r = await warmBatch(e, { drive });
    expect(r.warmed).toBe(0);
    expect(calls).toEqual([]);
  });
  it("DB triggers: a mode change and a thumb-wm change reset expected keys", async () => {
    await addGallery({ mode: "delivery" });
    await addPhoto();
    const arm = () =>
      db
        .update(schema.photos)
        .set({ cacheExpectedKey: "k", cacheWarmFailCount: 2 });
    const state = async () =>
      (await db.select().from(schema.photos).where(eq(schema.photos.id, P)))[0];
    await arm();
    await db.update(schema.galleries).set({ mode: "proofing" });
    expect((await state()).cacheExpectedKey).toBeNull();
    expect((await state()).cacheWarmFailCount).toBe(0);
    await arm();
    await db.update(schema.photos).set({ driveThumbWmId: "TWM2" });
    expect((await state()).cacheExpectedKey).toBeNull();
    await arm();
    await db
      .update(schema.photos)
      .set({ variantVersions: VERSIONS.replace("00:05Z", "00:09Z") });
    expect((await state()).cacheExpectedKey).toBeNull();
  });
});

describe("migration 0013_gallery_mode", () => {
  it("maps legacy use_watermark_preview=1 to proofing, else delivery", async () => {
    const mig = (
      env as unknown as { TEST_MIGRATIONS: D1Migration[] }
    ).TEST_MIGRATIONS.find((m) => m.name.startsWith("0013_gallery_mode"));
    expect(mig).toBeTruthy();
    const sql = mig!.queries.join("\n");
    expect(sql).toMatch(/UPDATE `galleries` SET `mode`/);
    // Simulate pre-migration rows: legacy flag set, mode still at its default.
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title, use_watermark_preview, mode) VALUES ('m1','f1','m1','A',1,'delivery'), ('m2','f2','m2','B',0,'delivery')",
      ),
    ]);
    for (const q of mig!.queries.filter((x) => /UPDATE `galleries`/.test(x)))
      await env.DB.exec(q.replace(/\s*\n\s*/g, " "));
    const r = await env.DB.prepare(
      "SELECT id, mode FROM galleries ORDER BY id",
    ).all<{ id: string; mode: string }>();
    expect(r.results).toEqual([
      { id: "m1", mode: "proofing" },
      { id: "m2", mode: "delivery" },
    ]);
  });
  it("rejects an invalid mode value", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title, mode) VALUES ('x','fx','x','A','nope')",
      ).run(),
    ).rejects.toThrow();
  });
});
