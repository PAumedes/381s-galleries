import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { runSync } from "../../app/lib/server/sync";
import {
  galleryAction,
  listGalleries,
} from "../../app/lib/server/admin-galleries";
import {
  deleteGallery,
  ignoredFolders,
  reincludeFolder,
} from "../../app/lib/server/gallery-delete";
import { setupData } from "../../app/routes/admin.setup";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const G = "dddddddd-0000-4000-8000-000000000001";
const FOLDER = "drive-folder-secret-ddd1";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables(
    "favorites",
    "downloads",
    "gallery_views",
    "visitors",
    "photos",
    "galleries",
    "rate_limits",
    "ignored_folders",
    "settings",
  );
  await clearCache();
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: FOLDER,
    slug: "boda-ana",
    title: "Boda Ana",
    status: "published",
    showOnHome: true,
  });
  await db.insert(schema.photos).values({
    id: "p-g",
    galleryId: G,
    baseName: "A",
    driveHighresId: "h1",
  });
});

const failingCache = {
  ...env.CACHE,
  delete: async () => {
    throw new Error("R2 down");
  },
} as unknown as R2Bucket;

describe("delete-gallery review", () => {
  it("the Ajustes loader payload must not carry Drive folder ids to the browser (CLAUDE.md)", async () => {
    await deleteGallery(e, G);
    const d = await setupData(new Request("http://localhost/admin/setup"), e);
    expect(JSON.stringify(d)).not.toContain(FOLDER);
  });

  it("an R2 failure surfaces as a handled result, not an unhandled throw (500 page)", async () => {
    const r = await galleryAction(
      new Request(`http://localhost/admin/g/${G}`, {
        method: "POST",
        body: new URLSearchParams({ intent: "delete", slug: "boda-ana" }),
      }),
      { ...e, CACHE: failingCache } as Env,
      G,
    ).then(
      (v) => v,
      (x) => x,
    );
    expect(r instanceof Error).toBe(false);
  });

  it("a half-deleted gallery stays reachable from the admin UI (list or Ajustes)", async () => {
    await deleteGallery({ ...e, CACHE: failingCache } as Env, G).catch(
      () => undefined,
    );
    const inList = (await listGalleries(e, "todas")).some((g) => g.id === G);
    const inIgnored = (await ignoredFolders(e)).length > 0;
    expect(inList || inIgnored).toBe(true);
  });

  it("orphan cache objects of photos sync already removed (r2_pending_deletes) are cleaned with the gallery", async () => {
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('r2_pending_deletes', ?1)",
    )
      .bind(JSON.stringify(["old-photo"]))
      .run();
    await env.CACHE.put("old-photo/thumb", "x");
    expect(await deleteGallery(e, G)).toBe("deleted");
    expect(await env.CACHE.head("old-photo/thumb")).toBeNull();
  });

  // Skipped: `select()[0]` is the seeded gallery G (rowid order), whose folder is not in the
  // mock Drive, so it can never be re-created. Covered with a real mock gallery in test/delete-gallery-fixes.test.ts.
  it.skip("'Volver a incluir' then the cron (non-forced) sync re-creates the gallery", async () => {
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const g = (await db.select().from(schema.galleries))[0]!;
    expect(await deleteGallery(e, g.id)).toBe("deleted");
    await runSync(e, { drive: d }); // tombstoned: skipped
    expect(await reincludeFolder(e, g.driveFolderId)).toBe(true);
    await runSync(e, { drive: d }); // next scheduled sync, nothing changed in Drive
    expect(
      (await db.select().from(schema.galleries)).some(
        (x) => x.driveFolderId === g.driveFolderId,
      ),
    ).toBe(true);
  });
});
