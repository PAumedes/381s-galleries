import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../app/db";
import {
  SETTINGS_KEYS,
  getSetting,
  putSetting,
} from "../app/lib/server/settings";
import {
  galleryAction,
  loadGalleryEdit,
} from "../app/lib/server/admin-galleries";

/** T6.53b2: the admin toggle for galleries.versioning (intent `versioning`). */
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const GID = "00000000-0000-4000-8000-0000000000d1";

beforeAll(migrateDb);
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.insert(schema.galleries).values({
    id: GID,
    driveFolderId: "f-d1",
    slug: "ver",
    title: "V",
    status: "draft",
  });
});
const act = (b: Record<string, string>) =>
  galleryAction(
    new Request(`http://localhost/admin/g/${GID}`, {
      method: "POST",
      body: new URLSearchParams(b),
    }),
    e,
    GID,
  );
const flag = async () =>
  (
    await db.select().from(schema.galleries).where(eq(schema.galleries.id, GID))
  )[0]!.versioning;

describe("T6.53b2 versioning toggle", () => {
  it("is off by default and the editor data carries it", async () => {
    expect(await flag()).toBe(false);
    expect((await loadGalleryEdit(e, GID))!.gallery.versioning).toBe(false);
  });

  it("turns on and off, with a message either way", async () => {
    const on = await act({ intent: "versioning", versioning: "1" });
    expect(on).toMatchObject({ ok: true, intent: "versioning" });
    expect(await flag()).toBe(true);
    expect((await loadGalleryEdit(e, GID))!.gallery.versioning).toBe(true);
    const off = await act({ intent: "versioning", versioning: "0" });
    expect(off).toMatchObject({ ok: true });
    expect(await flag()).toBe(false);
  });

  it.each(["", "2", "true", "on"])(
    "refuses %j and changes nothing",
    async (v) => {
      const r = await act({ intent: "versioning", versioning: v });
      expect(r).toMatchObject({ ok: false, intent: "versioning" });
      expect(await flag()).toBe(false);
    },
  );

  it("works on a published or archived album too (no other state is touched)", async () => {
    await db.update(schema.galleries).set({ status: "archived" });
    await act({ intent: "versioning", versioning: "1" });
    const [g] = await db.select().from(schema.galleries);
    expect(g).toMatchObject({ versioning: true, status: "archived" });
  });

  it("the exact entries a checked box posts (hidden 0, then 1) turn it ON; an unchecked box (only 0) turns it OFF", async () => {
    const post = (...values: string[]) => {
      const body = new FormData();
      body.append("intent", "versioning");
      for (const v of values) body.append("versioning", v);
      return galleryAction(
        new Request(`http://localhost/admin/g/${GID}`, {
          method: "POST",
          body,
        }),
        e,
        GID,
      );
    };
    expect(await post("0", "1")).toMatchObject({ ok: true });
    expect(await flag()).toBe(true);
    expect(await post("0")).toMatchObject({ ok: true });
    expect(await flag()).toBe(false);
  });

  it("switching it forgets the Drive changes token so the next sync rescans", async () => {
    await putSetting(e, SETTINGS_KEYS.driveChangesToken, "tok");
    await act({ intent: "versioning", versioning: "1" });
    expect(
      await getSetting(e, SETTINGS_KEYS.driveChangesToken),
    ).toBeUndefined();
    await putSetting(e, SETTINGS_KEYS.driveChangesToken, "tok");
    await act({ intent: "versioning", versioning: "0" });
    expect(
      await getSetting(e, SETTINGS_KEYS.driveChangesToken),
    ).toBeUndefined();
  });
  it("a refused value keeps the token", async () => {
    await putSetting(e, SETTINGS_KEYS.driveChangesToken, "tok");
    await act({ intent: "versioning", versioning: "2" });
    expect(await getSetting(e, SETTINGS_KEYS.driveChangesToken)).toBe("tok");
  });
});
