import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, nowIso, schema } from "../app/db";
import { gallerySessionCookie, pinFingerprint } from "../app/lib/server/auth";
import { hashPin } from "../app/lib/server/crypto";
import { APPROVALS_MAX } from "../app/lib/server/approvals-list";
import { handleSetApproval } from "../app/lib/server/approvals";
import { VERSIONED_APPROVALS_D1_QUERIES } from "../app/lib/server/d1-limits";
import {
  ANON_MAX_PER_WINDOW,
  handleListFavorites,
  handleVisitor,
} from "../app/lib/server/favorites";
import { buildOpenData } from "../app/lib/server/gallery-open-data";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv, noRatePrune } from "./support/warm";
import { seedVersioned } from "./support/versions";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000a5";
const BASE = "https://approve.test";

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables(
    "photo_approvals",
    "favorites",
    "visitors",
    "rate_limits",
    "photo_versions",
    "delivery_rounds",
    "photos",
    "galleries",
  );
  noRatePrune();
  return () => vi.restoreAllMocks();
});

async function addGallery(
  over: Partial<typeof schema.galleries.$inferInsert> = {},
) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "retoque",
    title: "Retoque",
    status: "published",
    versioning: true,
    requireEmail: false,
    ...over,
  });
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}/api/g/retoque/approvals`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const cookieOf = (res: Response) =>
  res.headers.getSetCookie()[0]?.split(";")[0] ?? "";
const approve = (
  body: unknown,
  headers: Record<string, string> = {},
  e: Env = env,
) => handleSetApproval(post(body, headers), "retoque", e);
const rows = () => db.select().from(schema.photoApprovals);
const list = async (cookie?: string, e: Env = env) => {
  const res = await handleListFavorites(
    new Request(`${BASE}/api/g/retoque/favorites`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    "retoque",
    e,
  );
  return (await res.json()) as Record<string, unknown>;
};
/** First approval: creates the anonymous visitor and returns its cookie. */
async function firstApproval(photoId: string, version: number, ip = "1.1.1.1") {
  const res = await approve(
    { photoId, version, on: true },
    { "CF-Connecting-IP": ip },
  );
  expect(res.status).toBe(200);
  return cookieOf(res);
}

describe("T6.53f approvals: POST /api/g/:slug/approvals", () => {
  it("approves the shown version, creating the anonymous visitor like a favorite", async () => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const res = await approve(
      { photoId: "A", version: 2, on: true },
      { "CF-Connecting-IP": "1.1.1.1" },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(cookieOf(res)).toMatch(/\S/);
    const [r] = await rows();
    expect(r).toMatchObject({ galleryId: G, photoId: "A", version: 2 });
    expect(r.visitorId).toBeTruthy();
    expect(r.approvedAt).toMatch(/^\d{4}-/);
  });

  it("is idempotent and un-approves only the caller's own approval", async () => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }]);
    const c1 = await firstApproval("A", 1, "1.1.1.1");
    const c2 = await firstApproval("A", 1, "2.2.2.2");
    expect(await rows()).toHaveLength(2);
    await approve({ photoId: "A", version: 1, on: true }, { Cookie: c1 });
    expect(await rows()).toHaveLength(2);
    const res = await approve(
      { photoId: "A", version: 1, on: false },
      { Cookie: c1 },
    );
    expect(res.status).toBe(200);
    const left = await rows();
    expect(left).toHaveLength(1);
    // the other visitor's approval is untouched
    expect((await list(c2)).approvals).toEqual([{ id: "A", ver: 1 }]);
    expect((await list(c1)).approvals).toEqual([]);
  });

  it("un-approving with no visitor is a no-op that creates nothing", async () => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }]);
    const res = await approve({ photoId: "A", version: 1, on: false });
    expect(res.status).toBe(200);
    expect(await db.select().from(schema.visitors)).toHaveLength(0);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("refuses a version that is not the shown one (stale) and writes nothing", async () => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const res = await approve(
      { photoId: "A", version: 1, on: true },
      { "CF-Connecting-IP": "1.1.1.1" },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stale" });
    expect(await rows()).toEqual([]);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("a version whose file left Drive is not shown, so it cannot be approved; the older one is", async () => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2, missing: true }]);
    const gone = await approve({ photoId: "A", version: 2, on: true });
    expect(gone.status).toBe(409);
    const ok = await approve(
      { photoId: "A", version: 1, on: true },
      { "CF-Connecting-IP": "1.1.1.1" },
    );
    expect(ok.status).toBe(200);
  });

  it("Prueba: approving is allowed; a version without its own preview-wm is not the shown one", async () => {
    await addGallery({ mode: "proofing" });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2, wm: false }]);
    expect((await approve({ photoId: "A", version: 2, on: true })).status).toBe(
      409,
    );
    const ok = await approve(
      { photoId: "A", version: 1, on: true },
      { "CF-Connecting-IP": "1.1.1.1" },
    );
    expect(ok.status).toBe(200);
  });

  it("a new version does not inherit the approval", async () => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }]);
    const c = await firstApproval("A", 1);
    await db.insert(schema.photoVersions).values({
      photoId: "A",
      galleryId: G,
      version: 2,
      driveHighresId: "HI-A-v2",
    });
    await db
      .update(schema.photos)
      .set({ driveHighresId: "HI-A-v2" })
      .where(eq(schema.photos.id, "A"));
    // v1 is no longer shown; v2 is open for review
    expect(
      (await approve({ photoId: "A", version: 1, on: true }, { Cookie: c }))
        .status,
    ).toBe(409);
    const res = await approve(
      { photoId: "A", version: 2, on: true },
      { Cookie: c },
    );
    expect(res.status).toBe(200);
    expect((await list(c)).approvals).toEqual([
      { id: "A", ver: 1 },
      { id: "A", ver: 2 },
    ]);
  });

  it.each([
    ["unknown photo", { photoId: "nope", version: 1, on: true }],
    ["another gallery's photo", { photoId: "OTHER", version: 1, on: true }],
  ])("404 for %s", async (_n, body) => {
    await addGallery();
    await db.insert(schema.galleries).values({
      id: "gggggggg-0000-0000-0000-0000000000a6",
      driveFolderId: "f2",
      slug: "otra",
      title: "Otra",
      status: "published",
      versioning: true,
    });
    await seedVersioned("gggggggg-0000-0000-0000-0000000000a6", "OTHER", [
      { n: 1 },
    ]);
    await seedVersioned(G, "A", [{ n: 1 }]);
    const res = await approve(body, { "CF-Connecting-IP": "1.1.1.1" });
    expect(res.status).toBe(404);
    expect(await rows()).toEqual([]);
  });

  it("404 for a photo whose file left Drive (missing_since)", async () => {
    await addGallery();
    await seedVersioned(G, "H", [{ n: 1 }]);
    await db
      .update(schema.photos)
      .set({ missingSince: "2026-01-01T00:00:00Z" })
      .where(eq(schema.photos.id, "H"));
    expect((await approve({ photoId: "H", version: 1, on: true })).status).toBe(
      404,
    );
  });

  it("an album without versioning has no approvals at all (404, nothing written)", async () => {
    await addGallery({ versioning: false });
    await seedVersioned(G, "A", [{ n: 1 }]);
    const res = await approve(
      { photoId: "A", version: 1, on: true },
      { "CF-Connecting-IP": "1.1.1.1" },
    );
    expect(res.status).toBe(404);
    expect(await rows()).toEqual([]);
    expect(await db.select().from(schema.visitors)).toHaveLength(0);
  });

  it("a photo with no version row (synced after the migration, before the next sync) answers 409 unavailable", async () => {
    await addGallery();
    await db.insert(schema.photos).values({
      id: "N",
      galleryId: G,
      baseName: "N",
      driveHighresId: "hr",
    });
    const res = await approve(
      { photoId: "N", version: 1, on: true },
      { "CF-Connecting-IP": "1.1.1.1" },
    );
    expect(res.status).toBe(409);
    expect(await rows()).toEqual([]);
  });

  it("draft, archived, expired and PIN-locked albums answer the same generic 404", async () => {
    const out: string[] = [];
    for (const [i, over] of [
      { status: "draft" as const },
      { status: "archived" as const },
      { expiresAt: nowIso(new Date(Date.now() - 1000)) },
      { pinHash: await hashPin("1234") },
    ].entries()) {
      await resetTables(
        "photo_approvals",
        "visitors",
        "photo_versions",
        "delivery_rounds",
        "photos",
        "galleries",
      );
      await addGallery({ ...over, driveFolderId: `f${i}` });
      await seedVersioned(G, "A", [{ n: 1 }]);
      const res = await approve(
        { photoId: "A", version: 1, on: true },
        { "CF-Connecting-IP": "1.1.1.1" },
      );
      expect(res.status).toBe(404);
      expect(res.headers.getSetCookie()).toEqual([]);
      out.push(await res.text());
      expect(await rows()).toEqual([]);
    }
    expect(new Set(out).size).toBe(1);
  });

  it("an unlocked PIN session may approve", async () => {
    await addGallery({ pinHash: await hashPin("1234") });
    await seedVersioned(G, "A", [{ n: 1 }]);
    const [g] = await db.select().from(schema.galleries);
    const cookie = (
      await gallerySessionCookie(
        {
          galleryId: G,
          unlocked: true,
          pf: await pinFingerprint(g.pinHash, env),
          viewed: true,
        },
        env,
        { secure: false },
      )
    ).split(";")[0];
    const res = await approve(
      { photoId: "A", version: 1, on: true },
      { Cookie: cookie, "CF-Connecting-IP": "1.1.1.1" },
    );
    expect(res.status).toBe(200);
    expect(await rows()).toHaveLength(1);
  });

  it("cross-site requests are refused", async () => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }]);
    for (const h of [
      { "Sec-Fetch-Site": "cross-site" },
      { Origin: "https://evil.test" },
    ]) {
      const res = await approve(
        { photoId: "A", version: 1, on: true },
        { ...h, "CF-Connecting-IP": "1.1.1.1" },
      );
      expect(res.status).toBe(403);
    }
    expect(await rows()).toEqual([]);
  });

  it("an email-gated album asks for the email first", async () => {
    await addGallery({ requireEmail: true });
    await seedVersioned(G, "A", [{ n: 1 }]);
    const res = await approve(
      { photoId: "A", version: 1, on: true },
      { "CF-Connecting-IP": "1.1.1.1" },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "email_required" });
    // after registering, it works
    const reg = await handleVisitor(
      new Request(`${BASE}/api/g/retoque/visitor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "1.1.1.1",
        },
        body: JSON.stringify({ email: "a@b.co" }),
      }),
      "retoque",
      env,
    );
    const ok = await approve(
      { photoId: "A", version: 1, on: true },
      { Cookie: cookieOf(reg) },
    );
    expect(ok.status).toBe(200);
  });

  it("the anonymous-visitor limiter applies (429 after ANON_MAX_PER_WINDOW from one IP)", async () => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }]);
    let last = 200;
    for (let i = 0; i <= ANON_MAX_PER_WINDOW; i++)
      last = (
        await approve(
          { photoId: "A", version: 1, on: true },
          { "CF-Connecting-IP": "9.9.9.9" },
        )
      ).status;
    expect(last).toBe(429);
  });

  it.each([
    ["no body", undefined],
    ["not an object", [1]],
    ["photoId missing", { version: 1, on: true }],
    ["photoId empty", { photoId: "", version: 1, on: true }],
    ["photoId too long", { photoId: "x".repeat(129), version: 1, on: true }],
    ["on not boolean", { photoId: "A", version: 1, on: "yes" }],
    ["version string", { photoId: "A", version: "1", on: true }],
    ["version float", { photoId: "A", version: 1.5, on: true }],
    ["version zero", { photoId: "A", version: 0, on: true }],
    ["version negative", { photoId: "A", version: -1, on: true }],
    ["version too big", { photoId: "A", version: 1000, on: true }],
    ["version NaN-ish", { photoId: "A", version: null, on: true }],
  ])("400 for malformed input: %s", async (_n, body) => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }]);
    const res = await approve(body, { "CF-Connecting-IP": "1.1.1.1" });
    expect(res.status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it("caps the approvals of one visitor at APPROVALS_MAX (409 limit)", async () => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }]);
    await seedVersioned(G, "B", [{ n: 1 }], { sort: 1 });
    const c = await firstApproval("A", 1);
    const [vis] = await db.select().from(schema.visitors);
    expect(APPROVALS_MAX).toBeGreaterThan(10);
    // fill the quota with rows of the same visitor on a bulk of other versions
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO photo_versions (photo_id, gallery_id, version, drive_highres_id)
         WITH RECURSIVE n(i) AS (SELECT 2 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
         SELECT 'B', ?2, i, 'h' FROM n`,
      ).bind(APPROVALS_MAX, G),
      env.DB.prepare(
        `INSERT INTO photo_approvals (gallery_id, photo_id, version, visitor_id)
         WITH RECURSIVE n(i) AS (SELECT 2 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
         SELECT ?2, 'B', i, ?3 FROM n`,
      ).bind(APPROVALS_MAX, G, vis.id),
    ]);
    await seedVersioned(G, "C", [{ n: 1 }], { sort: 2 });
    const res = await approve(
      { photoId: "C", version: 1, on: true },
      { Cookie: c },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "limit" });
    // un-approving still works at the cap
    expect(
      (await approve({ photoId: "A", version: 1, on: false }, { Cookie: c }))
        .status,
    ).toBe(200);
  }, 60_000);
});

describe("T6.53f approvals in the favorites list (the visitor's own, folded in)", () => {
  it("an unversioned album's list is byte-identical: no `approvals` key at all", async () => {
    await addGallery({ versioning: false });
    await seedVersioned(G, "A", [{ n: 1 }]);
    expect(await list()).toEqual({ visitor: null, favorites: [] });
    const reg = await handleVisitor(
      new Request(`${BASE}/api/g/retoque/visitor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "1.1.1.1",
        },
        body: JSON.stringify({ email: "a@b.co" }),
      }),
      "retoque",
      env,
    );
    expect(await list(cookieOf(reg))).toEqual({
      visitor: { email: "a@b.co", name: null },
      favorites: [],
    });
  });

  it("a versioned album lists only the caller's approvals, never another visitor's or any id", async () => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    await seedVersioned(G, "B", [{ n: 1 }], { sort: 1 });
    const c1 = await firstApproval("A", 2, "1.1.1.1");
    await firstApproval("B", 1, "2.2.2.2");
    const body = await list(c1);
    expect(body.approvals).toEqual([{ id: "A", ver: 2 }]);
    expect(JSON.stringify(body)).not.toMatch(/visitor_id|HI-|WM-|round/);
    expect((await list()).approvals).toEqual([]);
  });

  it("costs exactly VERSIONED_APPROVALS_D1_QUERIES more than the same list without versioning", async () => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }]);
    const c = await firstApproval("A", 1);
    const on = countingEnv(env);
    await list(c, on.e);
    await db
      .update(schema.galleries)
      .set({ versioning: false })
      .where(eq(schema.galleries.id, G));
    const off = countingEnv(env);
    await list(c, off.e);
    expect(VERSIONED_APPROVALS_D1_QUERIES).toBe(1);
    expect(on.count() - off.count()).toBe(VERSIONED_APPROVALS_D1_QUERIES);
  });

  it("approvals of a deleted version row vanish with it (no orphans)", async () => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const c = await firstApproval("A", 2);
    await db
      .delete(schema.photoVersions)
      .where(
        and(
          eq(schema.photoVersions.photoId, "A"),
          eq(schema.photoVersions.version, 2),
        ),
      );
    expect(await rows()).toEqual([]);
    expect((await list(c)).approvals).toEqual([]);
  });
});

describe("T6.53f approvals flag in the open payload", () => {
  const open = async () => {
    const [g] = await db.select().from(schema.galleries);
    return buildOpenData(env, g);
  };

  it("only a versioned album says approvals are on, and no photo carries approval data", async () => {
    await addGallery();
    await seedVersioned(G, "A", [{ n: 1 }]);
    const on = await open();
    expect(on.gallery.approvals).toBe(true);
    expect(JSON.stringify(on.photos)).not.toMatch(/approv/i);
  });

  it("an unversioned album's payload is byte-identical to before (no approvals key)", async () => {
    await addGallery({ versioning: false });
    await seedVersioned(G, "A", [{ n: 1 }]);
    const off = await open();
    expect("approvals" in off.gallery).toBe(false);
    expect(JSON.stringify(off)).not.toMatch(/approv/i);
  });
});
