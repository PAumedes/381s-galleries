import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "../app/db";
import {
  IMMUTABLE_CACHE_CONTROL,
  imageVersionToken,
  serveImage,
} from "../app/lib/server/images";
import { cacheKey } from "../app/lib/server/image-source";
import { fillCache } from "../app/lib/server/images";
import { clearCache } from "./support/cache";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv, fakeWarmDrive, noRatePrune } from "./support/warm";
import { files, modified, seedVersioned } from "./support/versions";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000d1";
const e = { ...env, DRIVE_MODE: "google" } as Env;

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables("photo_versions", "delivery_rounds", "photos", "galleries");
  await clearCache();
  noRatePrune();
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "retoque",
    title: "Retoque",
    status: "published",
    versioning: true,
  });
  return () => vi.restoreAllMocks();
});

async function get(
  variant: string,
  query = "",
  o: { e?: Env; photoId?: string } = {},
) {
  const drive = fakeWarmDrive();
  const pending: Promise<unknown>[] = [];
  const photoId = o.photoId ?? "A";
  const res = await serveImage(
    new Request(`https://x.test/img/${photoId}/${variant}${query}`),
    { photoId, variant },
    o.e ?? e,
    {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
      passThroughOnException() {},
    } as unknown as ExecutionContext,
    { drive: drive.drive },
  );
  await Promise.all(pending);
  return { res, calls: drive.calls };
}
const keys = async () =>
  (await env.CACHE.list()).objects.map((o) => o.key).sort();

describe("T6.53c cache key", () => {
  it("v1 keeps <photoId>/<variant>; N >= 2 is <photoId>/v<N>/<variant>", () => {
    expect(cacheKey({ id: "A" }, "thumb")).toBe("A/thumb");
    expect(cacheKey({ id: "A", version: 1 }, "thumb")).toBe("A/thumb");
    expect(cacheKey({ id: "A", version: 2 }, "view-sm")).toBe("A/v2/view-sm");
    expect(cacheKey({ id: "A", version: 12 }, "view-lg")).toBe("A/v12/view-lg");
  });
});

describe("T6.53c /img serves the latest version", () => {
  it("the latest version's file is fetched and cached under the v2 key", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const { res, calls } = await get("thumb");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["TH-A-v2"]);
    expect(await keys()).toEqual(["A/v2/thumb"]);
  });

  it("a photo that never got a v2 keeps the plain v1 key", async () => {
    await seedVersioned(G, "A", [{ n: 1 }]);
    const { calls } = await get("thumb");
    expect(calls).toEqual(["TH-A-v1"]);
    expect(await keys()).toEqual(["A/thumb"]);
  });

  it("a second request is an R2 hit", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    await get("view-sm");
    const again = await get("view-sm");
    expect(again.calls).toEqual([]);
    expect(again.res.status).toBe(200);
  });

  it("a v3 that left Drive (missingSince) is not served: the latest present version is", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }, { n: 3, missing: true }]);
    const { calls } = await get("thumb");
    expect(calls).toEqual(["TH-A-v2"]);
  });

  it("immutable caching when ?v= is the latest version's token", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const [row] = await db.select().from(schema.photos);
    const v = await imageVersionToken(
      env,
      { ...row, ...files("A", 2), variantVersions: modified(2) },
      false,
    );
    const ok = await get("thumb", `?v=${v}`);
    expect(ok.res.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE_CONTROL);
    const stale = await get("thumb", "?v=nope");
    expect(stale.res.headers.get("Cache-Control")).toBe("private, max-age=600");
  });

  it("Prueba: the latest version without preview-wm falls back to the newest one with it", async () => {
    await db.update(schema.galleries).set({ mode: "proofing" });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }, { n: 3, wm: false }]);
    const { res, calls } = await get("view-sm");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["WM-A-v2"]);
    expect(await keys()).toEqual(["A/v2/view-sm"]);
  });
});

describe("T6.53c /img?ver=N (history previews)", () => {
  it("serves that version's file and caches it under its own key", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }, { n: 3 }]);
    const v1 = await get("thumb", "?ver=1");
    expect(v1.calls).toEqual(["TH-A-v1"]);
    const v2 = await get("view-sm", "?ver=2");
    expect(v2.calls).toEqual(["WEB-A-v2"]);
    expect(await keys()).toEqual(["A/thumb", "A/v2/view-sm"]);
  });

  it("immutable when ?v= is that version's token", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const [row] = await db.select().from(schema.photos);
    const v = await imageVersionToken(
      env,
      { ...row, ...files("A", 1), variantVersions: modified(1) },
      false,
    );
    const r = await get("thumb", `?ver=1&v=${v}`);
    expect(r.res.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  it.each(["0", "-1", "1.5", "01", "abc", "", "1000", "99999999999", "1e1"])(
    "invalid ver=%s is the generic 404",
    async (bad) => {
      await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
      const { res, calls } = await get("thumb", `?ver=${bad}`);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
      expect(calls).toEqual([]);
    },
  );

  it("a version that does not exist or left Drive is a 404", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }, { n: 3, missing: true }]);
    expect((await get("thumb", "?ver=3")).res.status).toBe(404);
    expect((await get("thumb", "?ver=4")).res.status).toBe(404);
  });

  it("an album with versioning off: ?ver= is a 404 and the plain URL is unchanged", async () => {
    await db.update(schema.galleries).set({ versioning: false });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    expect((await get("thumb", "?ver=1")).res.status).toBe(404);
    const plain = await get("thumb");
    // The photos row (not the version rows) serves: its mirror is v2's file,
    // cached under the plain key.
    expect(plain.calls).toEqual(["TH-A-v2"]);
    expect(await keys()).toEqual(["A/thumb"]);
  });

  it("Prueba: an old version without preview-wm is a 404 (never the clean file)", async () => {
    await db.update(schema.galleries).set({ mode: "proofing" });
    await seedVersioned(G, "A", [{ n: 1, wm: false }, { n: 2 }]);
    const r = await get("view-sm", "?ver=1");
    expect(r.res.status).toBe(404);
    expect(r.calls).toEqual([]);
  });

  it("Prueba: an old version with preview-wm serves it watermarked", async () => {
    await db.update(schema.galleries).set({ mode: "proofing" });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const r = await get("view-lg", "?ver=1");
    expect(r.calls).toEqual(["WM-A-v1"]);
  });

  it("a draft album is still a 404 for ver", async () => {
    await db.update(schema.galleries).set({ status: "draft" });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    expect((await get("thumb", "?ver=1")).res.status).toBe(404);
  });
});

describe("T6.53c /img D1 queries", () => {
  it("a versioning-off album costs the same as before; a versioned one exactly one more", async () => {
    await db.update(schema.galleries).set({ versioning: false });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const off = countingEnv(e);
    await get("thumb", "", { e: off.e });
    await db.update(schema.galleries).set({ versioning: true });
    const on = countingEnv(e);
    await get("thumb", "", { e: on.e });
    // 2 = the photo lookup and the R2-miss rate limit (measured on the old code).
    expect(off.count()).toBe(2);
    expect(on.count()).toBe(3);
  });
});

describe("T6.53c fillCache keys", () => {
  it("copies from a sibling of the same version only (Prueba: one preview-wm file)", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const [row] = await db.select().from(schema.photos);
    const photo = {
      ...row,
      ...files("A", 2),
      variantVersions: modified(2),
      version: 2,
      proofing: true,
    };
    const drive = fakeWarmDrive();
    await fillCache(env, photo, "view-sm", drive.drive);
    await fillCache(env, photo, "view-lg", drive.drive);
    expect(drive.calls).toEqual(["WM-A-v2"]); // view-lg copied from view-sm
    expect(await keys()).toEqual(["A/v2/view-lg", "A/v2/view-sm"]);
  });

  it("the mirror row is untouched by reads", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    await get("thumb");
    const [row] = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.id, "A"));
    expect(row.driveThumbId).toBe("TH-A-v2");
  });
});
