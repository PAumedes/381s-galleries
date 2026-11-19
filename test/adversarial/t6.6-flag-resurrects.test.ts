import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { galleryAction } from "../../app/lib/server/admin-galleries";
import { hashPin } from "../../app/lib/server/crypto";
import { loadHome } from "../../app/lib/server/home";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const GID = "00000000-0000-4000-8000-0000000000a1";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.insert(schema.galleries).values({
    id: GID,
    driveFolderId: "f-a1",
    slug: "resurrect",
    title: "R",
    status: "published",
    showOnHome: true,
  });
  await db.insert(schema.photos).values({
    id: "00000000-0000-4000-8000-0000000000b1",
    galleryId: GID,
    baseName: "IMG_1",
    driveHighresId: "hr",
    width: 3000,
    height: 2000,
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
const slugs = async () => (await loadHome(e)).items.map((i) => i.slug);

describe("show_on_home must not silently come back", () => {
  it("setting then removing a PIN does not re-publish the gallery on the public home", async () => {
    expect(await slugs()).toEqual(["resurrect"]);
    await act({ intent: "pin", mode: "set", pin: "secret-pin-1" });
    expect(await slugs()).toEqual([]);
    await act({ intent: "pin", mode: "remove" });
    // Owner never re-opted in after protecting it.
    expect(await slugs()).toEqual([]);
  });
  it("unpublish then publish does not re-list it without a new opt-in", async () => {
    await act({ intent: "status", to: "draft" });
    await act({ intent: "status", to: "publish" });
    expect(await slugs()).toEqual([]);
  });
  it("archive then restore does not re-list it without a new opt-in", async () => {
    await act({ intent: "status", to: "archive" });
    await act({ intent: "status", to: "restore" });
    expect(await slugs()).toEqual([]);
  });
  it("(control) a PIN set directly hides it", async () => {
    await db.update(schema.galleries).set({ pinHash: await hashPin("123456") });
    expect(await slugs()).toEqual([]);
  });
});
