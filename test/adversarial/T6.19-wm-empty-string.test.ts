import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import {
  listGalleries,
  loadGalleryEdit,
} from "../../app/lib/server/admin-galleries";
import { buildOpenData } from "../../app/lib/server/gallery";
import { loadHome } from "../../app/lib/server/home";

const e = { ...env, DRIVE_MODE: "mock" } as Env;
const db = getDb(env);
const GID = "eeeeeeee-0000-4000-8000-000000000001";
const PID = "ffffffff-0000-4000-8000-000000000001";

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.insert(schema.galleries).values({
    id: GID,
    slug: "g-empty",
    title: "G",
    driveFolderId: "f",
    status: "published",
    showOnHome: true,
    mode: "proofing",
  });
});

describe("T6.19 adversarial: preview-wm presence is decided one way everywhere", () => {
  it("a '' drive_wm_id: home (SQL IS NOT NULL) must agree with the public page (JS truthiness)", async () => {
    await db.insert(schema.photos).values({
      id: PID,
      galleryId: GID,
      baseName: "A",
      driveHighresId: "h",
      driveWmId: "",
      sort: 0,
    });
    const [g] = await db.select().from(schema.galleries);
    const pub = (await buildOpenData(e, g!)).gallery.coverPhotoId;
    const home = (await loadHome(e)).items.find((i) => i.slug === "g-empty");
    // public page names no cover => home must not name one either
    expect({ pub, home: home?.cover.id ?? null }).toEqual({
      pub: null,
      home: null,
    });
  });
  it("a '' drive_wm_id: the editor count agrees with the public page (wmCount 0)", async () => {
    await db.insert(schema.photos).values({
      id: PID,
      galleryId: GID,
      baseName: "A",
      driveHighresId: "h",
      driveWmId: "",
      sort: 0,
    });
    const d = (await loadGalleryEdit(e, GID))!;
    expect(d.wmCount).toBe(0);
  });
  it("admin list in Prueba without any preview-wm must not name a (clean) photo as cover, like every other view", async () => {
    await db.insert(schema.photos).values({
      id: PID,
      galleryId: GID,
      baseName: "A",
      driveHighresId: "h",
      driveWmId: null,
      sort: 0,
    });
    const row = (await listGalleries(e, "all")).find((r) => r.id === GID)!;
    expect(row.coverPhotoId).toBeNull();
  });
});
