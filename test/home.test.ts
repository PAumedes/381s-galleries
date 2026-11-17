import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { galleryAction } from "../app/lib/server/admin-galleries";
import { hashPin } from "../app/lib/server/crypto";
import { loadHome, HOME_CAP } from "../app/lib/server/home";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const nonAdmin = { ...e, ALLOW_DEV_ADMIN: "0" } as Env;
const db = getDb(env);

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});
beforeEach(async () => {
  await db.delete(schema.galleries);
});

async function gallery(
  over: Partial<typeof schema.galleries.$inferInsert> = {},
  photoOver: Partial<typeof schema.photos.$inferInsert> | null = {},
) {
  const id = over.id ?? uid();
  await db.insert(schema.galleries).values({
    id,
    driveFolderId: `drive-folder-${id}`,
    slug: `slug-${id.slice(-6)}`,
    title: `T-${id.slice(-6)}`,
    status: "published",
    showOnHome: true,
    ...over,
  });
  let photoId: string | null = null;
  if (photoOver) {
    photoId = uid();
    await db.insert(schema.photos).values({
      id: photoId,
      galleryId: id,
      baseName: `IMG_${photoId.slice(-6)}`,
      driveHighresId: `hr-${photoId}`,
      sort: 0,
      width: 3000,
      height: 2000,
      ...photoOver,
    });
  }
  return { id, photoId };
}

const slugs = async () => (await loadHome(e)).items.map((i) => i.slug);

describe("migration 0016", () => {
  it("show_on_home exists, defaults to 0 and is CHECKed to 0/1", async () => {
    const id = uid();
    await env.DB.prepare(
      "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES (?,?,?,?)",
    )
      .bind(id, `f-${id}`, `s-${id}`, "x")
      .run();
    const r = await env.DB.prepare(
      "SELECT show_on_home FROM galleries WHERE id=?",
    )
      .bind(id)
      .first<{ show_on_home: number }>();
    expect(r!.show_on_home).toBe(0);
    for (const bad of [2, -1, "yes"])
      await expect(
        env.DB.prepare("UPDATE galleries SET show_on_home=? WHERE id=?")
          .bind(bad, id)
          .run(),
      ).rejects.toThrow();
  });
});

describe("loadHome query rules", () => {
  it("lists a published, no-PIN, flagged gallery with a cover", async () => {
    const { id } = await gallery({ slug: "ok" });
    expect(await slugs()).toEqual(["ok"]);
    expect(id).toBeTruthy();
  });
  it("excludes show_on_home=0, draft, archived, expired, PIN, no photos", async () => {
    await gallery({ slug: "off", showOnHome: false });
    await gallery({ slug: "draft", status: "draft" });
    await gallery({ slug: "arch", status: "archived" });
    await gallery({ slug: "exp", expiresAt: "2000-01-01T00:00:00Z" });
    await gallery({ slug: "garbage", expiresAt: "not-a-date" });
    await gallery({ slug: "pin", pinHash: await hashPin("123456") });
    await gallery({ slug: "nophotos" }, null);
    await gallery({ slug: "future", expiresAt: "2999-01-01T00:00:00Z" });
    expect(await slugs()).toEqual(["future"]);
  });
  it("setting a PIN or unpublishing hides it at once", async () => {
    const { id } = await gallery({ slug: "live" });
    expect(await slugs()).toEqual(["live"]);
    await env.DB.prepare("UPDATE galleries SET pin_hash='x' WHERE id=?")
      .bind(id)
      .run();
    expect(await slugs()).toEqual([]);
    await env.DB.prepare(
      "UPDATE galleries SET pin_hash=NULL, status='draft' WHERE id=?",
    )
      .bind(id)
      .run();
    expect(await slugs()).toEqual([]);
  });
  it("orders by event date else created date, newest first, capped", async () => {
    await gallery({ slug: "a", eventDate: "2024-05-01" });
    await gallery({ slug: "b", eventDate: "2026-01-10" });
    await gallery({
      slug: "c",
      eventDate: null,
      createdAt: "2025-03-01T00:00:00Z",
    });
    expect(await slugs()).toEqual(["b", "c", "a"]);
    expect(HOME_CAP).toBe(60);
  });
  it("caps the list", async () => {
    for (let i = 0; i < HOME_CAP + 5; i++)
      await gallery({ slug: `g${i}`, eventDate: "2024-01-01" });
    expect((await loadHome(e)).items).toHaveLength(HOME_CAP);
  });
  it("uses the chosen cover when it is visible, else the first photo", async () => {
    const { id, photoId } = await gallery({ slug: "c1" });
    const second = uid();
    await db.insert(schema.photos).values({
      id: second,
      galleryId: id,
      baseName: "ZZ",
      driveHighresId: "hr2",
      sort: 5,
    });
    await db
      .update(schema.galleries)
      .set({ coverPhotoId: second })
      .where((await import("drizzle-orm")).eq(schema.galleries.id, id));
    expect((await loadHome(e)).items[0].cover.id).toBe(second);
    await env.DB.prepare(
      "UPDATE photos SET missing_since='2026-01-01T00:00:00Z' WHERE id=?",
    )
      .bind(second)
      .run();
    expect((await loadHome(e)).items[0].cover.id).toBe(photoId);
  });
  it("Prueba: cover is a photo with preview-wm; none -> excluded", async () => {
    const { id } = await gallery({ slug: "pr", mode: "proofing" });
    expect(await slugs()).toEqual([]);
    const wm = uid();
    await db.insert(schema.photos).values({
      id: wm,
      galleryId: id,
      baseName: "WM",
      driveHighresId: "hrw",
      driveWmId: "wm-file",
      sort: 9,
    });
    expect((await loadHome(e)).items[0].cover.id).toBe(wm);
  });
  it("exposes the focal point only when both coordinates are set", async () => {
    await gallery({ slug: "f1", coverFocusX: 20, coverFocusY: 70 });
    await gallery({ slug: "f2", coverFocusX: 20, eventDate: "2000-01-01" });
    const items = (await loadHome(e)).items;
    expect(items.find((i) => i.slug === "f1")!.cover.focus).toEqual({
      x: 20,
      y: 70,
    });
    expect(items.find((i) => i.slug === "f2")!.cover.focus).toBeNull();
  });
});

describe("loadHome payload", () => {
  it("leaks nothing beyond slug, title, date and the cover", async () => {
    await gallery(
      {
        slug: "leak",
        clientName: "SECRET CLIENT",
        driveFolderId: "DRIVEFOLDERSECRET",
        eventDate: "2026-02-02",
        coverFocusX: 10,
        coverFocusY: 10,
      },
      {
        driveHighresId: "DRIVEHRSECRET",
        driveWebId: "DRIVEWEBSECRET",
        variantVersions: JSON.stringify({
          highres: "2026-01-01T00:00:00Z",
          web: "2026-01-01T00:00:00Z",
        }),
      },
    );
    const home = await loadHome(e);
    const json = JSON.stringify(home);
    for (const bad of [
      "SECRET",
      "DRIVE",
      "pin",
      "Pin",
      "clientName",
      "status",
      "expires",
      "folder",
    ])
      expect(json).not.toContain(bad);
    expect(Object.keys(home).sort()).toEqual(["items"]);
    expect(Object.keys(home.items[0]).sort()).toEqual([
      "cover",
      "eventDate",
      "slug",
      "title",
    ]);
    expect(Object.keys(home.items[0].cover).sort()).toEqual([
      "aspect",
      "focus",
      "id",
      "v",
    ]);
    expect(home.items[0].cover.v).toMatch(/^[0-9a-f]{16}$/);
    expect(home.items[0].cover.aspect).toBeCloseTo(1.5);
  });
});

describe("admin intent home", () => {
  const act = (id: string, b: Record<string, string>, env_ = e) =>
    galleryAction(
      new Request(`http://localhost/admin/g/${id}`, {
        method: "POST",
        body: new URLSearchParams(b),
      }),
      env_,
      id,
    );
  const flag = async (id: string) =>
    (await env.DB.prepare("SELECT show_on_home s FROM galleries WHERE id=?")
      .bind(id)
      .first<{ s: number }>())!.s;

  it("turns it on and off", async () => {
    const { id } = await gallery({ showOnHome: false });
    const r = await act(id, { intent: "home", showOnHome: "1" });
    expect(r.ok).toBe(true);
    expect(await flag(id)).toBe(1);
    expect((await act(id, { intent: "home", showOnHome: "0" })).ok).toBe(true);
    expect(await flag(id)).toBe(0);
  });
  it("refuses to enable with a PIN or when not published, but always allows disabling", async () => {
    const pinned = await gallery({
      showOnHome: false,
      pinHash: await hashPin("123456"),
    });
    const r = await act(pinned.id, { intent: "home", showOnHome: "1" });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.showOnHome).toBeTruthy();
    expect(await flag(pinned.id)).toBe(0);
    const draft = await gallery({ showOnHome: false, status: "draft" });
    expect((await act(draft.id, { intent: "home", showOnHome: "1" })).ok).toBe(
      false,
    );
    expect(await flag(draft.id)).toBe(0);
    const on = await gallery({ showOnHome: true, status: "draft" });
    expect((await act(on.id, { intent: "home", showOnHome: "0" })).ok).toBe(
      true,
    );
    expect(await flag(on.id)).toBe(0);
  });
  it("rejects invalid values without writing", async () => {
    const { id } = await gallery({ showOnHome: false });
    for (const v of ["2", "true", "", "on"]) {
      const r = await act(id, { intent: "home", showOnHome: v });
      expect(r.ok).toBe(false);
    }
    expect((await act(id, { intent: "home" })).ok).toBe(false);
    expect(await flag(id)).toBe(0);
  });
  it("is admin-only and rejects cross-site posts", async () => {
    const { id } = await gallery({ showOnHome: false });
    const bad = await act(id, { intent: "home", showOnHome: "1" }, nonAdmin)
      .then(() => 200)
      .catch((r: Response) => r.status);
    expect(bad).toBe(401);
    const cross = await galleryAction(
      new Request(`http://localhost/admin/g/${id}`, {
        method: "POST",
        body: new URLSearchParams({ intent: "home", showOnHome: "1" }),
        headers: { Origin: "https://evil.example" },
      }),
      e,
      id,
    )
      .then(() => 200)
      .catch((r: Response) => r.status);
    expect(cross).toBe(403);
    expect(await flag(id)).toBe(0);
  });
});
