import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import {
  galleryAction,
  loadGalleryEdit,
} from "../app/lib/server/admin-galleries";
import { DriveError } from "../app/lib/server/drive-types";
import type { DriveClient } from "../app/lib/server/drive-types";
import {
  IMMUTABLE_CACHE_CONTROL,
  adminImageToken,
  serveImage,
} from "../app/lib/server/images";
import {
  adminImageResponse,
  serveAdminImage,
} from "../app/routes/admin.img.$photoId.$variant";

const db = getDb(env);
const G = "cccccccc-0000-0000-0000-00000000000a";
// requireAdmin's dev bypass needs mock mode; warming is driven by the injected
// drive (the route injects none in mock mode), so saves use the mock env.
const mockAdmin = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const googleEnv = { ...env, DRIVE_MODE: "google" } as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  for (const o of (await env.CACHE.list()).objects)
    await env.CACHE.delete(o.key);
});

/** Fake Drive: records every streamed file id; each call costs `cost` subrequests. */
function fakeDrive(
  o: { fail?: Set<string>; cost?: number; noLength?: boolean } = {},
) {
  let subs = 0;
  const calls: string[] = [];
  const drive = {
    subrequests: () => subs,
    async streamFile(id: string) {
      calls.push(id);
      subs += o.cost ?? 1;
      if (o.fail?.has(id)) throw new DriveError(500, "x", "detail " + id);
      return new Response(JPEG.slice(), {
        headers: o.noLength
          ? {}
          : {
              "Content-Length": String(JPEG.length),
              "Content-Type": "image/jpeg",
            },
      });
    },
  } as unknown as DriveClient;
  return { drive, calls };
}

/** An ExecutionContext that remembers what was handed to waitUntil. */
function recorder() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
      passThroughOnException() {},
    } as unknown as ExecutionContext,
    done: async () => void (await Promise.all(pending)),
    count: () => pending.length,
  };
}

async function seed(
  gallery: Partial<typeof schema.galleries.$inferInsert> = {},
  ids = ["p1", "p2", "p3"],
  photo: (
    id: string,
  ) => Partial<typeof schema.photos.$inferInsert> = () => ({}),
) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "folder-secret",
    slug: "cover-lag",
    title: "T",
    status: "draft",
    ...gallery,
  });
  for (const id of ids)
    await db.insert(schema.photos).values({
      id,
      galleryId: G,
      baseName: id,
      driveHighresId: `HI-${id}`,
      driveWebId: `WEB-${id}`,
      driveThumbId: `TH-${id}`,
      driveWmId: `WM-${id}`,
      driveThumbWmId: `TWM-${id}`,
      variantVersions: JSON.stringify({
        highres: "2026-01-01T00:00:01Z",
        web: "2026-01-01T00:00:02Z",
        thumb: "2026-01-01T00:00:03Z",
        wm: "2026-01-01T00:00:04Z",
        thumbWm: "2026-01-01T00:00:05Z",
      }),
      width: 300,
      height: 200,
      ...photo(id),
    });
}

const save = (
  fields: Record<string, string>,
  e: Env,
  deps: Parameters<typeof galleryAction>[3],
) =>
  galleryAction(
    new Request(`http://localhost/admin/g/${G}`, {
      method: "POST",
      body: new URLSearchParams({ intent: "cover", ...fields }),
    }),
    e,
    G,
    deps,
  );
const keys = async () =>
  (await env.CACHE.list()).objects.map((o) => o.key).sort();

describe("cover save warms R2 for that photo only", () => {
  it("desktop cover: thumb, view-sm and view-lg of the chosen photo land in R2", async () => {
    await seed();
    const { drive, calls } = fakeDrive();
    const r = recorder();
    const res = await save({ photoId: "p2" }, mockAdmin, { ctx: r.ctx, drive });
    expect(res.ok).toBe(true);
    // The answer does not wait for Drive: the work is handed to waitUntil.
    expect(r.count()).toBe(1);
    await r.done();
    expect(await keys()).toEqual(["p2/thumb", "p2/view-lg", "p2/view-sm"]);
    // Only files of that photo were read, nothing of p1 / p3.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.endsWith("-p2"))).toBe(true);
    const head = await env.CACHE.head("p2/view-lg");
    expect(head?.customMetadata?.wm).toBe("0");
    expect(head?.customMetadata?.fileId).toBe("HI-p2");
  });

  it("mobile cover warms too", async () => {
    await seed();
    const { drive, calls } = fakeDrive();
    const r = recorder();
    const res = await save({ photoId: "p3", device: "mobile" }, mockAdmin, {
      ctx: r.ctx,
      drive,
    });
    expect(res.ok).toBe(true);
    await r.done();
    expect(await keys()).toEqual(["p3/thumb", "p3/view-lg", "p3/view-sm"]);
    expect(calls.every((c) => c.endsWith("-p3"))).toBe(true);
  });

  it("an already valid R2 object costs no Drive call", async () => {
    await seed();
    const first = fakeDrive();
    const r1 = recorder();
    await save({ photoId: "p1" }, mockAdmin, {
      ctx: r1.ctx,
      drive: first.drive,
    });
    await r1.done();
    const again = fakeDrive();
    const r2 = recorder();
    await save({ photoId: "p1", device: "mobile" }, mockAdmin, {
      ctx: r2.ctx,
      drive: again.drive,
    });
    await r2.done();
    expect(again.calls).toEqual([]);
  });

  it("Prueba: only watermarked files are read and stored, never a clean one", async () => {
    await seed({ mode: "proofing" });
    const { drive, calls } = fakeDrive();
    const r = recorder();
    await save({ photoId: "p2" }, mockAdmin, { ctx: r.ctx, drive });
    await r.done();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toMatch(/^(WM|TWM)-p2$/);
    for (const k of await keys()) {
      expect((await env.CACHE.head(k))?.customMetadata?.wm).toBe("1");
    }
  });

  it("Prueba photo without preview-wm: nothing is fetched (no clean fallback)", async () => {
    await seed({ mode: "proofing" }, ["p1", "p2"], (id) =>
      id === "p2" ? { driveWmId: null, driveThumbWmId: null } : {},
    );
    const { drive, calls } = fakeDrive();
    const r = recorder();
    await save({ photoId: "p2" }, mockAdmin, { ctx: r.ctx, drive });
    await r.done();
    expect(calls).toEqual([]);
    expect(await keys()).toEqual([]);
  });

  it("does not warm when the save fails, when clearing, or without a drive (mock mode)", async () => {
    await seed();
    await db.insert(schema.galleries).values({
      id: "other",
      driveFolderId: "f2",
      slug: "other-g",
      title: "O",
      status: "draft",
    });
    await db.insert(schema.photos).values({
      id: "alien",
      galleryId: "other",
      baseName: "alien",
      driveHighresId: "HI-alien",
      driveWebId: "WEB-alien",
      variantVersions: JSON.stringify({ highres: "v", web: "v" }),
    });
    const { drive, calls } = fakeDrive();
    const r = recorder();
    // photo of another gallery: refused
    expect(
      (await save({ photoId: "alien" }, mockAdmin, { ctx: r.ctx, drive })).ok,
    ).toBe(false);
    // clearing the mobile cover
    expect(
      (
        await save({ photoId: "", device: "mobile" }, mockAdmin, {
          ctx: r.ctx,
          drive,
        })
      ).ok,
    ).toBe(true);
    // no drive injected (mock mode: placeholders, nothing to warm)
    expect((await save({ photoId: "p1" }, mockAdmin, { ctx: r.ctx })).ok).toBe(
      true,
    );
    await r.done();
    expect(r.count()).toBe(0);
    expect(calls).toEqual([]);
    expect(await keys()).toEqual([]);
  });

  it("a failing Drive never fails the save; the cover is stored", async () => {
    await seed();
    const { drive } = fakeDrive({
      fail: new Set(["WEB-p2", "TH-p2", "HI-p2"]),
    });
    const r = recorder();
    const res = await save({ photoId: "p2" }, mockAdmin, { ctx: r.ctx, drive });
    expect(res.ok).toBe(true);
    await expect(r.done()).resolves.toBeUndefined();
    const [g] = await db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.id, G));
    expect(g!.coverPhotoId).toBe("p2");
    expect(await keys()).toEqual([]);
  });

  it("stays inside a small Drive subrequest budget", async () => {
    await seed();
    const { drive, calls } = fakeDrive({ cost: 4 });
    const r = recorder();
    await save({ photoId: "p2" }, mockAdmin, { ctx: r.ctx, drive });
    await r.done();
    expect(calls.length).toBe(2);
  });

  it("works without a context (tests/other callers): the save still succeeds", async () => {
    await seed();
    const res = await save({ photoId: "p2" }, mockAdmin, undefined);
    expect(res.ok).toBe(true);
    expect(await keys()).toEqual([]);
  });
});

describe("admin image caching headers", () => {
  const url = (id: string, variant: string, v?: string) =>
    `http://localhost/admin/img/${id}/${variant}${v === undefined ? "" : `?v=${v}`}`;
  /** The route's path: serveImage(admin) then the wrapper's header policy. */
  const get = async (
    id: string,
    variant: string,
    v?: string,
    e: Env = googleEnv,
  ) => {
    const { drive } = fakeDrive();
    const res = await serveImage(
      new Request(url(id, variant, v)),
      { photoId: id, variant },
      e,
      recorder().ctx,
      { drive },
      { admin: true },
    );
    return adminImageResponse(res);
  };
  const tokenOf = async (id: string) => {
    const [p] = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.id, id));
    return adminImageToken(googleEnv, p!);
  };

  it("loader hands each photo a token; the token hides Drive ids", async () => {
    await seed();
    const data = await loadGalleryEdit(googleEnv, G);
    const p = data!.photos[0]!;
    expect(p.v).toMatch(/^[0-9a-f]{16}$/);
    expect(p.v).toBe(await tokenOf(p.id));
    expect(JSON.stringify(data)).not.toMatch(
      /HI-p|WEB-p|TH-p|WM-p|folder-secret/,
    );
  });

  it("matching ?v= is private + immutable (cold Drive path and R2 hit)", async () => {
    await seed();
    const v = (await tokenOf("p1"))!;
    const cold = await get("p1", "thumb", v);
    expect(cold.status).toBe(200);
    expect(cold.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE_CONTROL);
    await cold.arrayBuffer();
    await new Promise((r) => setTimeout(r, 20));
    const hit = await get("p1", "thumb", v);
    expect(hit.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE_CONTROL);
    for (const r of [cold, hit]) {
      expect(r.headers.get("Cache-Control")).toMatch(/\bprivate\b/);
      expect(r.headers.get("Cache-Control")).not.toMatch(/public|s-maxage/);
      expect(r.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    }
  });

  it("no ?v=, a wrong one or an empty one stays private, no-store", async () => {
    await seed();
    for (const v of [undefined, "", "0000000000000000", "x".repeat(300)]) {
      const r = await get("p1", "thumb", v);
      expect(r.headers.get("Cache-Control"), String(v)).toBe(
        "private, no-store",
      );
    }
  });

  it("a token changes when a file or its version changes (re-export is never stale)", async () => {
    await seed();
    const before = (await tokenOf("p1"))!;
    await db
      .update(schema.photos)
      .set({
        variantVersions: JSON.stringify({
          highres: "2026-01-01T00:00:01Z",
          web: "2027-01-01T00:00:00Z",
          thumb: "2026-01-01T00:00:03Z",
          wm: "2026-01-01T00:00:04Z",
          thumbWm: "2026-01-01T00:00:05Z",
        }),
      })
      .where(eq(schema.photos.id, "p1"));
    const after = (await tokenOf("p1"))!;
    expect(after).not.toBe(before);
    const old = await get("p1", "view-sm", before);
    expect(old.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("a photo with an unknown file version never gets a token (never immutable)", async () => {
    await seed({}, ["p1"], () => ({ variantVersions: null }));
    expect(await tokenOf("p1")).toBeNull();
    const data = await loadGalleryEdit(googleEnv, G);
    expect(data!.photos[0]!.v ?? null).toBeNull();
    const r = await get("p1", "thumb", "anything");
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("errors and the mock redirect are never cacheable, even with a valid-looking ?v=", async () => {
    await seed();
    const v = (await tokenOf("p1"))!;
    const unknown = await get("nope", "thumb", v);
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("Cache-Control")).toBe("private, no-store");
    const bad = await get("p1", "view-lg", v);
    expect(bad.status).toBe(404);
    expect(bad.headers.get("Cache-Control")).toBe("private, no-store");
    const mock = await get("p1", "thumb", v, mockAdmin);
    expect(mock.status).toBe(302);
    expect(mock.headers.get("Cache-Control")).toBe("private, no-store");
    // ...and through the real route function (admin guard + wrapper).
    const viaRoute = await serveAdminImage(
      new Request(url("p1", "thumb", v)),
      { photoId: "p1", variant: "thumb" },
      mockAdmin,
      recorder().ctx,
      { drive: fakeDrive().drive },
    );
    expect(viaRoute.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("adminImageResponse: only a 200/304 that the image core marked immutable stays cacheable", () => {
    const mk = (status: number, cc: string) =>
      adminImageResponse(
        new Response(status === 304 ? null : "x", {
          status,
          headers: { "Cache-Control": cc },
        }),
      );
    expect(mk(200, IMMUTABLE_CACHE_CONTROL).headers.get("Cache-Control")).toBe(
      IMMUTABLE_CACHE_CONTROL,
    );
    expect(mk(304, IMMUTABLE_CACHE_CONTROL).headers.get("Cache-Control")).toBe(
      IMMUTABLE_CACHE_CONTROL,
    );
    expect(mk(200, "private, max-age=600").headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    expect(mk(200, "public, max-age=600").headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    expect(mk(404, IMMUTABLE_CACHE_CONTROL).headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    expect(mk(502, IMMUTABLE_CACHE_CONTROL).headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
  });

  it("Prueba admin variants: clean and watermarked files share one token, still private", async () => {
    await seed({ mode: "proofing" });
    const v = (await tokenOf("p1"))!;
    for (const variant of ["thumb", "view-sm", "thumb-wm", "view-sm-wm"]) {
      const r = await get("p1", variant, v);
      expect(r.status, variant).toBe(200);
      expect(r.headers.get("Cache-Control"), variant).toBe(
        IMMUTABLE_CACHE_CONTROL,
      );
      await r.arrayBuffer();
    }
    // Admin clean files in Prueba still never reach R2 (shared keys with the public watermarked ones).
    for (const k of await keys()) {
      expect((await env.CACHE.head(k))?.customMetadata?.wm).toBe("1");
    }
  });

  it("the public /img route is unchanged: admin tokens do not unlock immutable there", async () => {
    await seed({ status: "published" });
    const v = (await tokenOf("p1"))!;
    const { drive } = fakeDrive();
    const r = await serveImage(
      new Request(`http://localhost/img/p1/thumb?v=${v}`),
      { photoId: "p1", variant: "thumb" },
      googleEnv,
      recorder().ctx,
      { drive },
    );
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=600");
  });
});
