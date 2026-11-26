import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../app/db";
import { galleryAction } from "../../app/lib/server/admin-galleries";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const GID = "00000000-0000-4000-8000-0000000000d2";
beforeAll(migrateDb);
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.insert(schema.galleries).values({
    id: GID,
    driveFolderId: "f-d2",
    slug: "ver2",
    title: "V",
    status: "draft",
  });
});

// The real form (VersioningSection) submits [intent, versioning=0, versioning=1]
// when the box is checked (pinned by the dom test). FormData.get returns the first.
it("a checked box (hidden 0 then checkbox 1, as the browser posts it) turns versioning ON", async () => {
  const body = new FormData();
  body.append("intent", "versioning");
  body.append("versioning", "0");
  body.append("versioning", "1");
  const r = await galleryAction(
    new Request(`http://localhost/admin/g/${GID}`, { method: "POST", body }),
    e,
    GID,
  );
  expect(r).toMatchObject({ ok: true });
  const [g] = await db
    .select()
    .from(schema.galleries)
    .where(eq(schema.galleries.id, GID));
  expect(g.versioning).toBe(true);
});
