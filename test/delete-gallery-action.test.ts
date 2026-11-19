import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import {
  galleryAction,
  listGalleries,
  loadGalleryEdit,
  countGalleries,
} from "../app/lib/server/admin-galleries";
import { es } from "../app/i18n/es";
import { loadHome } from "../app/lib/server/home";
import { adminIndexData } from "../app/routes/admin._index";
import { setupAction, setupData } from "../app/routes/admin.setup";
import { editData } from "../app/routes/admin.g.$id";
import {
  handleDownloadTokens,
  serveDownload,
} from "../app/lib/server/downloads";
import {
  deleteGallery,
  folderHandle,
  ignoredFolders,
} from "../app/lib/server/gallery-delete";
import type { DriveClient } from "../app/lib/server/drive-types";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const nonAdmin = { ...e, ALLOW_DEV_ADMIN: "0" } as Env;
const db = getDb(env);
const G = "cccccccc-0000-4000-8000-000000000001";
const H = "cccccccc-0000-4000-8000-000000000002";
const FOLDER = "drive-folder-secret-ccc1";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await env.DB.batch(
    [
      "favorites",
      "downloads",
      "gallery_views",
      "visitors",
      "photos",
      "galleries",
      "rate_limits",
      "ignored_folders",
      "settings",
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  await db.insert(schema.galleries).values([
    {
      id: G,
      driveFolderId: FOLDER,
      slug: "boda-ana",
      title: "Boda Ana",
      status: "published",
      showOnHome: true,
    },
    {
      id: H,
      driveFolderId: "drive-folder-other-ccc2",
      slug: "otra",
      title: "Otra",
      status: "published",
      showOnHome: true,
    },
  ]);
  await db.insert(schema.photos).values([
    {
      id: "p-g",
      galleryId: G,
      baseName: "A",
      driveHighresId: "h1",
      driveWebId: "w1",
    },
    {
      id: "p-h",
      galleryId: H,
      baseName: "B",
      driveHighresId: "h2",
      driveWebId: "w2",
    },
  ]);
});

const post = (
  fields: Record<string, string>,
  headers: HeadersInit = {},
  id = G,
) =>
  new Request(`http://localhost/admin/g/${id}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  });
const del = (
  fields: Record<string, string>,
  headers: HeadersInit = {},
  envx = e,
  id = G,
) =>
  galleryAction(post({ intent: "delete", ...fields }, headers, id), envx, id);
const caught = async (p: Promise<unknown>) =>
  (await p.then(
    (v) => v,
    (x) => x,
  )) as Response & { ok?: boolean; error?: string };
const exists = async (id: string) =>
  (await env.DB.prepare("SELECT 1 AS x FROM galleries WHERE id = ?1")
    .bind(id)
    .first()) !== null;

describe("delete intent: guards", () => {
  it("401 for a non-admin and deletes nothing", async () => {
    expect((await caught(del({ slug: "boda-ana" }, {}, nonAdmin))).status).toBe(
      401,
    );
    expect(await exists(G)).toBe(true);
  });
  it.each([
    [{ "Sec-Fetch-Site": "cross-site" }],
    [{ Origin: "https://evil.test" }],
  ])("403 cross-site %j, deletes nothing", async (h) => {
    expect((await caught(del({ slug: "boda-ana" }, h))).status).toBe(403);
    expect(await exists(G)).toBe(true);
    expect(await ignoredFolders(e)).toEqual([]);
  });
  it.each([["wrong"], [""], ["otra"], ["boda-an"]])(
    "wrong slug %j deletes nothing and writes no tombstone",
    async (slug) => {
      const r = await caught(del({ slug }));
      expect(r.ok).toBe(false);
      expect(r.error).toBe(es["admin.msg.deleteSlugMismatch"]);
      expect(await exists(G)).toBe(true);
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM ignored_folders",
        ).first<{ n: number }>(),
      ).toEqual({ n: 0 });
      expect(
        await env.DB.prepare("SELECT status FROM galleries WHERE id = ?1")
          .bind(G)
          .first(),
      ).toEqual({ status: "published" });
    },
  );
  it("a missing slug field deletes nothing", async () => {
    const r = await caught(galleryAction(post({ intent: "delete" }), e, G));
    expect(r.ok).toBe(false);
    expect(await exists(G)).toBe(true);
  });
  it("404 for an unknown gallery", async () => {
    expect((await caught(del({ slug: "x" }, {}, e, "nope"))).status).toBe(404);
  });
});

describe("delete intent: success", () => {
  it("redirects to /admin with a flash flag, removes the gallery and keeps the other one", async () => {
    const r = await caught(del({ slug: "boda-ana" }));
    expect(r).toBeInstanceOf(Response);
    expect(r.status).toBe(303);
    expect(r.headers.get("Location")).toBe("/admin?deleted=1");
    expect(await exists(G)).toBe(false);
    expect(await exists(H)).toBe(true);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM photos").first<{
        n: number;
      }>())!.n,
    ).toBe(1);
  });
  it("the slug is compared case-insensitively and trimmed", async () => {
    expect((await caught(del({ slug: "  Boda-Ana " }))).status).toBe(303);
    expect(await exists(G)).toBe(false);
  });
  it("a double submit is idempotent: the second one is a clean 404 and nothing changes", async () => {
    await caught(del({ slug: "boda-ana" }));
    const r = await caught(del({ slug: "boda-ana" }));
    expect(r.status).toBe(404);
    expect(await exists(H)).toBe(true);
    expect(await ignoredFolders(e)).toHaveLength(1);
  });
  it("a gallery featured on the home page disappears from it", async () => {
    expect((await loadHome(e)).items.map((i) => i.slug)).toContain("boda-ana");
    await caught(del({ slug: "boda-ana" }));
    const slugs = (await loadHome(e)).items.map((i) => i.slug);
    expect(slugs).not.toContain("boda-ana");
    expect(slugs).toContain("otra");
  });
  it("the flash message shows on /admin", async () => {
    const d = await adminIndexData(
      new Request("http://localhost/admin?deleted=1"),
      e,
    );
    expect(d.message).toBe(es["admin.msg.galleryDeleted"]);
    const none = await adminIndexData(new Request("http://localhost/admin"), e);
    expect(none.message).toBeNull();
  });
  it("neither the redirect nor an error carries the gallery id, the folder id or an IP", async () => {
    const wrong = await caught(
      del({ slug: "no" }, { "CF-Connecting-IP": "203.0.113.7" }),
    );
    const ok = await caught(
      del({ slug: "boda-ana" }, { "CF-Connecting-IP": "203.0.113.7" }),
    );
    const dump = JSON.stringify(wrong) + [...ok.headers].join();
    for (const s of [G, FOLDER, "203.0.113.7"]) expect(dump).not.toContain(s);
  });
});

describe("a deletion in progress", () => {
  it("stays listed as deleting, other intents are stale, and a resubmit finishes", async () => {
    await env.CACHE.put("p-g/thumb", "x");
    expect(await deleteGallery(e, G, { r2CallsMax: 0 })).toBe("continue");
    expect(
      (await listGalleries(e, "todas")).map((g) => [g.id, g.deleting]).sort(),
    ).toEqual([
      [G, true],
      [H, false],
    ]);
    expect(await countGalleries(e)).toBe(2);
    const stale = await galleryAction(
      post({ intent: "details", title: "Zombi", slug: "zombi" }),
      e,
      G,
    );
    expect(stale.ok).toBe(false);
    expect(
      await env.DB.prepare("SELECT title FROM galleries WHERE id = ?1")
        .bind(G)
        .first(),
    ).toEqual({ title: "Boda Ana" });
    const data = await loadGalleryEdit(e, G);
    expect(data?.deleting).toBe(true);
    expect((await caught(del({ slug: "boda-ana" }))).status).toBe(303);
    expect(await exists(G)).toBe(false);
  });
  it("reports 'continuing' (not an error page) when the R2 budget runs out", async () => {
    // 700 photos with a 1-call budget is covered in delete-gallery.test.ts; here the action wiring.
    const rows = [];
    for (let i = 0; i < 400; i++)
      rows.push(
        env.DB.prepare(
          "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES (?1, ?2, ?3, 'h')",
        ).bind(`m-${i}`, G, `M${i}`),
      );
    for (let i = 0; i < rows.length; i += 50)
      await env.DB.batch(rows.slice(i, i + 50));
    const calls: number[] = [];
    const small = {
      ...e,
      CACHE: new Proxy(env.CACHE, {
        get(t, k) {
          if (k === "delete")
            return (keys: string[]) => {
              calls.push(keys.length);
              return t.delete(keys);
            };
          const v = (t as never)[k];
          return typeof v === "function" ? (v as () => unknown).bind(t) : v;
        },
      }),
    } as Env;
    const r = await caught(del({ slug: "boda-ana" }, {}, small));
    expect(r.ok === false || r.status === 303).toBe(true);
    expect(calls.every((n) => n <= 1000)).toBe(true);
  });
});

describe("download token in flight", () => {
  it("a token issued before the deletion gets a clean 410 afterwards and logs nothing", async () => {
    const BASE = "https://session.test";
    await env.DB.prepare("UPDATE galleries SET require_email = 0 WHERE id = ?1")
      .bind(G)
      .run();
    const res = await handleDownloadTokens(
      new Request(`${BASE}/api/g/boda-ana/download-tokens`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.5",
        },
        body: JSON.stringify({ photoIds: ["p-g"], variant: "web" }),
      }),
      "boda-ana",
      e,
    );
    const token = (
      (await res.json()) as { tokens: { url: string }[] }
    ).tokens[0].url.replace("/dl/", "");
    expect(await deleteGallery(e, G)).toBe("deleted");
    const drive = {
      async streamFile() {
        return new Response("x");
      },
    } as unknown as DriveClient;
    const dl = await serveDownload(
      new Request(`${BASE}/dl/${token}`, {
        headers: { "CF-Connecting-IP": "203.0.113.5" },
      }),
      token,
      { ...e, DRIVE_MODE: "google" } as Env,
      { drive },
    );
    expect(dl.status).toBe(410);
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM downloads WHERE gallery_id = ?1",
      )
        .bind(G)
        .first<{ n: number }>())!.n,
    ).toBe(0);
  });
  it("a token whose gallery is only marked (deleting) is refused too", async () => {
    const BASE = "https://session.test";
    await env.DB.prepare("UPDATE galleries SET require_email = 0 WHERE id = ?1")
      .bind(G)
      .run();
    const res = await handleDownloadTokens(
      new Request(`${BASE}/api/g/boda-ana/download-tokens`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.5",
        },
        body: JSON.stringify({ photoIds: ["p-g"], variant: "web" }),
      }),
      "boda-ana",
      e,
    );
    const token = (
      (await res.json()) as { tokens: { url: string }[] }
    ).tokens[0].url.replace("/dl/", "");
    await deleteGallery(e, G, { r2CallsMax: 0 });
    const drive = {
      async streamFile() {
        return new Response("x");
      },
    } as unknown as DriveClient;
    const dl = await serveDownload(
      new Request(`${BASE}/dl/${token}`),
      token,
      { ...e, DRIVE_MODE: "google" } as Env,
      { drive },
    );
    expect(dl.status).toBe(410);
  });
});

describe("Ajustes: ignored folders", () => {
  const SETUP = "http://localhost/admin/setup";
  const sPost = (f: Record<string, string>, h: HeadersInit = {}) =>
    new Request(SETUP, {
      method: "POST",
      headers: h,
      body: new URLSearchParams(f),
    });

  it("setupData lists the tombstones (opaque handle and date only, never the Drive id)", async () => {
    await deleteGallery(e, G);
    const d = await setupData(new Request(SETUP), e);
    expect(d.ignoredFolders).toHaveLength(1);
    expect(Object.keys(d.ignoredFolders[0]).sort()).toEqual([
      "deletedAt",
      "handle",
    ]);
    expect(JSON.stringify(d)).not.toContain(FOLDER);
  });
  it("401 non-admin, 403 cross-site, and unconfirmed or unknown requests remove nothing", async () => {
    await deleteGallery(e, G);
    const f = {
      intent: "reinclude",
      handle: await folderHandle(e, FOLDER),
      confirm: "1",
    };
    expect((await caught(setupAction(sPost(f), nonAdmin))).status).toBe(401);
    expect(
      (
        await caught(
          setupAction(sPost(f, { "Sec-Fetch-Site": "cross-site" }), e),
        )
      ).status,
    ).toBe(403);
    const noConfirm = await setupAction(
      sPost({ intent: "reinclude", handle: await folderHandle(e, FOLDER) }),
      e,
    );
    expect(noConfirm.ok).toBe(false);
    const unknown = await setupAction(
      sPost({ intent: "reinclude", handle: "nope", confirm: "1" }),
      e,
    );
    expect(unknown.ok).toBe(false);
    expect(await ignoredFolders(e)).toHaveLength(1);
  });
  it("with confirmation it removes the tombstone", async () => {
    await deleteGallery(e, G);
    const r = await setupAction(
      sPost({
        intent: "reinclude",
        handle: await folderHandle(e, FOLDER),
        confirm: "1",
      }),
      e,
    );
    expect(r.ok).toBe(true);
    expect(await ignoredFolders(e)).toEqual([]);
  });
});

describe("editor page for a deleted gallery", () => {
  it("404 after deletion", async () => {
    await deleteGallery(e, G);
    const r = await caught(
      editData(new Request("http://localhost/admin/g/x"), e, G),
    );
    expect(r.status).toBe(404);
  });
});
