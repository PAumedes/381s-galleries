import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../app/db";
import { galleryAction } from "../app/lib/server/admin-galleries";
import { headers } from "../app/routes/home";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const GID = "00000000-0000-4000-8000-0000000000c1";

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
    driveFolderId: "f-c1",
    slug: "flag",
    title: "F",
    status: "published",
    showOnHome: true,
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
  )[0]!.showOnHome;

describe("show_on_home lifecycle", () => {
  it("saving a past expiry clears the flag", async () => {
    await act({
      intent: "details",
      title: "F",
      slug: "flag",
      expiresDate: "2020-01-01",
    });
    expect(await flag()).toBe(false);
  });
  it("saving a future expiry keeps the flag", async () => {
    await act({
      intent: "details",
      title: "F",
      slug: "flag",
      expiresDate: "2099-01-01",
    });
    expect(await flag()).toBe(true);
  });
  it("enabling is refused while expired", async () => {
    await db
      .update(schema.galleries)
      .set({ showOnHome: false, expiresAt: "2020-01-01T00:00:00.000Z" });
    await act({ intent: "home", showOnHome: "1" });
    expect(await flag()).toBe(false);
  });
});

describe("home route headers", () => {
  it("returns no-store (applies to document and .data responses)", () => {
    expect(headers()["Cache-Control"]).toBe("private, no-store");
  });
});
