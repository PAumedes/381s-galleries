import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import {
  FAVORITES_MAX,
  handleSetFavorite,
  handleVisitor,
} from "../../app/lib/server/favorites";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000a1";
const BASE = "https://session.test";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM favorites"),
    env.DB.prepare("DELETE FROM visitors"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM photos"),
    env.DB.prepare("DELETE FROM galleries"),
  ]);
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f1",
    slug: "boda",
    title: "Boda",
    status: "published",
    requireEmail: false,
  });
});
const addPhoto = (
  id: string,
  over: Partial<typeof schema.photos.$inferInsert> = {},
) =>
  db.insert(schema.photos).values({
    id,
    galleryId: G,
    baseName: `IMG_${id}`,
    driveHighresId: `hr-${id}`,
    sort: 1,
    ...over,
  });
const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`${BASE}/api/g/boda/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "9.9.9.9",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const cookieOf = (r: Response) =>
  r.headers.getSetCookie()[0]?.split(";")[0] ?? "";

describe("T2.4 adversarial", () => {
  it("anonymous favorite POSTs without a cookie must not create unbounded visitor rows", async () => {
    await addPhoto("p1");
    for (let i = 0; i < 40; i++) {
      await handleSetFavorite(
        post("favorites", { photoId: "p1", on: true }),
        "boda",
        env,
      );
    }
    const n = (await db.select().from(schema.visitors)).length;
    expect(n).toBeLessThanOrEqual(20); // bounded (orchestrator: 20 to allow shared venue Wi-Fi);
  });

  it("favorites cap is not exceeded by concurrent adds", async () => {
    await addPhoto("p0");
    const r = await handleVisitor(
      post("visitor", { email: "a@b.co" }),
      "boda",
      env,
    );
    const cookie = cookieOf(r);
    const [v] = await db.select().from(schema.visitors);
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i < ?2)
       INSERT INTO photos (id, gallery_id, base_name, drive_highres_id, sort) SELECT 'f'||i, ?1, 'F'||i, 'h'||i, 1 FROM n`,
    )
      .bind(G, FAVORITES_MAX - 2)
      .run();
    await env.DB.prepare(
      `INSERT INTO favorites (gallery_id, visitor_id, photo_id) SELECT ?1, ?2, id FROM photos WHERE id LIKE 'f%'`,
    )
      .bind(G, v.id)
      .run();
    const extra = Array.from({ length: 6 }, (_, i) => ({
      id: `x${i}`,
      galleryId: G,
      baseName: `X${i}`,
      driveHighresId: `hx${i}`,
      sort: 1,
    }));
    await db.insert(schema.photos).values(extra);
    await Promise.all(
      extra.map((p) =>
        handleSetFavorite(
          post("favorites", { photoId: p.id, on: true }, { Cookie: cookie }),
          "boda",
          env,
        ),
      ),
    );
    const n = (await env.DB.prepare(
      "SELECT COUNT(*) n FROM favorites WHERE visitor_id=?1",
    )
      .bind(v.id)
      .first<{ n: number }>())!.n;
    expect(n).toBeLessThanOrEqual(FAVORITES_MAX);
  }, 60000);

  it("anon visitor cookie must not bypass the email gate after require_email is turned on", async () => {
    await addPhoto("p1");
    await addPhoto("p2", { baseName: "b2", driveHighresId: "h2" });
    const r = await handleSetFavorite(
      post("favorites", { photoId: "p1", on: true }),
      "boda",
      env,
    );
    const cookie = cookieOf(r);
    expect(cookie).not.toBe("");
    await env.DB.prepare("UPDATE galleries SET require_email=1").run();
    const r2 = await handleSetFavorite(
      post("favorites", { photoId: "p2", on: true }, { Cookie: cookie }),
      "boda",
      env,
    );
    expect(r2.status).toBe(403);
  });

  it("favorites on a since-hidden photo must not permanently eat the cap / be un-removable", async () => {
    await addPhoto("p1");
    const r = await handleVisitor(
      post("visitor", { email: "a@b.co" }),
      "boda",
      env,
    );
    const cookie = cookieOf(r);
    await handleSetFavorite(
      post("favorites", { photoId: "p1", on: true }, { Cookie: cookie }),
      "boda",
      env,
    );
    await env.DB.prepare(
      "UPDATE photos SET missing_since = '2020-01-01T00:00:00Z'",
    ).run();
    const off = await handleSetFavorite(
      post("favorites", { photoId: "p1", on: false }, { Cookie: cookie }),
      "boda",
      env,
    );
    expect(off.status).toBe(200);
  });
});
