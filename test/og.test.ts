import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { gallerySessionCookie, pinFingerprint } from "../app/lib/server/auth";
import { hashPin } from "../app/lib/server/crypto";
import { loadGallery } from "../app/lib/server/gallery";
import { galleryMeta } from "../app/lib/og";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-000000000001";

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM gallery_views"),
    env.DB.prepare("DELETE FROM photos"),
    env.DB.prepare("DELETE FROM galleries"),
  ]);
});

async function addGallery(
  over: Partial<typeof schema.galleries.$inferInsert> = {},
) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "boda-ana",
    title: "Boda Ana",
    status: "published",
    eventDate: "2026-11-14",
    ...over,
  });
}
async function addPhoto(
  n: number,
  over: Partial<typeof schema.photos.$inferInsert> = {},
) {
  await db.insert(schema.photos).values({
    id: `p${n}`,
    galleryId: G,
    baseName: `IMG_${n}`,
    driveHighresId: `hi${n}`,
    width: 3000,
    height: 2000,
    sort: n,
    ...over,
  });
}
const req = (headers: Record<string, string> = {}) =>
  new Request("https://session.381studios.ar/boda-ana", { headers });

describe("loadGallery: theme + og preview data", () => {
  it("theme defaults to light and follows the column", async () => {
    await addGallery();
    await addPhoto(1);
    const light = (await loadGallery(req(), "boda-ana", env)).data;
    expect(light.state === "open" && light.gallery.palette).toBe("claro");
    await db.update(schema.galleries).set({ palette: "oscuro" });
    const dark = (await loadGallery(req(), "boda-ana", env)).data;
    expect(dark.state === "open" && dark.gallery.palette).toBe("oscuro");
  });

  it("og preview: cover id + 1200 long-edge size (landscape and portrait)", async () => {
    await addGallery();
    await addPhoto(1);
    await addPhoto(2, { width: 2000, height: 3000 });
    await db.update(schema.galleries).set({ coverPhotoId: "p2" });
    const d = (await loadGallery(req(), "boda-ana", env)).data;
    expect(d.state === "open" && d.og).toEqual({
      coverId: "p2",
      width: 800,
      height: 1200,
    });
  });

  it("og preview: size omitted when dimensions unknown; null with no photos", async () => {
    await addGallery();
    await addPhoto(1, { width: null, height: null });
    let d = (await loadGallery(req(), "boda-ana", env)).data;
    expect(d.state === "open" && d.og).toEqual({
      coverId: "p1",
      width: null,
      height: null,
    });
    await db.delete(schema.photos);
    d = (await loadGallery(req(), "boda-ana", env)).data;
    expect(d.state === "open" && d.og).toEqual({
      coverId: null,
      width: null,
      height: null,
    });
  });

  it("a hidden (missing) cover is not exposed", async () => {
    await addGallery();
    await addPhoto(1);
    await addPhoto(2);
    await db.update(schema.galleries).set({ coverPhotoId: "p1" });
    await db
      .update(schema.photos)
      .set({ missingSince: "2026-01-01T00:00:00Z" })
      .where(eq(schema.photos.id, "p1"));
    const d = (await loadGallery(req(), "boda-ana", env)).data;
    expect(d.state === "open" && d.og?.coverId).toBe("p2");
  });

  it("PIN gallery: locked has theme and no og; unlocked open has og null", async () => {
    const pinHash = await hashPin("1234");
    await addGallery({ pinHash, palette: "oscuro" });
    await addPhoto(1);
    const locked = (await loadGallery(req(), "boda-ana", env)).data;
    expect(locked).toEqual({
      state: "locked",
      slug: "boda-ana",
      title: "Boda Ana",
      palette: "oscuro",
    });
    const c = await gallerySessionCookie(
      { galleryId: G, unlocked: true, pf: await pinFingerprint(pinHash, env) },
      env,
      { secure: false },
    );
    const open = (
      await loadGallery(req({ Cookie: c.split(";")[0] }), "boda-ana", env)
    ).data;
    expect(open.state).toBe("open");
    expect(open.state === "open" && open.og).toBeNull();
  });

  it.each([
    "WhatsApp/2.23.20.0 A",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "TelegramBot (like TwitterBot)",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (Macintosh) Slack-ImgProxy",
    "Mozilla/5.0 Applebot Mac OS X iMessage LinkPresentation",
  ])("link-preview bot %s is not logged as a view", async (ua) => {
    await addGallery();
    await addPhoto(1);
    await loadGallery(
      req({ "User-Agent": ua, "CF-Connecting-IP": "1.2.3.4" }),
      "boda-ana",
      env,
    );
    const n = await env.DB.prepare(
      "SELECT count(*) n FROM gallery_views",
    ).first<{
      n: number;
    }>();
    expect(n!.n).toBe(0);
  });
});

const ORIGIN = "https://session.381studios.ar";
const openData = (over = {}) =>
  ({
    state: "open",
    gallery: { title: "Boda Ana", eventDate: "2026-11-14", slug: "boda-ana" },
    og: { coverId: "p1", width: 1200, height: 800 },
    ...over,
  }) as never;
const find = (m: Record<string, string>[], k: string, v = "property") =>
  m.find((x) => x[v] === k)?.content;
const base = { studio: "381 Studios", lang: "es", origin: ORIGIN };

describe("galleryMeta", () => {
  it("full preview for an open public gallery", () => {
    const m = galleryMeta(openData(), base) as Record<string, string>[];
    expect(find(m, "og:type")).toBe("website");
    expect(find(m, "og:site_name")).toBe("381 Studios");
    expect(find(m, "og:title")).toBe("Boda Ana");
    expect(find(m, "og:description")).toBe(
      "14 de noviembre de 2026 · 381 Studios",
    );
    expect(find(m, "og:url")).toBe(`${ORIGIN}/boda-ana`);
    expect(find(m, "og:image")).toBe(`${ORIGIN}/img/p1/view-sm`);
    expect(find(m, "og:image:width")).toBe("1200");
    expect(find(m, "og:image:height")).toBe("800");
    expect(find(m, "og:image:alt")).toBe("Boda Ana");
    expect(find(m, "twitter:card", "name")).toBe("summary_large_image");
    expect(find(m, "robots", "name")).toBe("noindex,nofollow");
  });

  it("english date; no date falls back to studio only", () => {
    const en = galleryMeta(openData(), { ...base, lang: "en" }) as Record<
      string,
      string
    >[];
    expect(find(en, "og:description")).toBe("November 14, 2026 · 381 Studios");
    const nd = galleryMeta(
      openData({ gallery: { title: "T", eventDate: null, slug: "boda-ana" } }),
      base,
    ) as Record<string, string>[];
    expect(find(nd, "og:description")).toBe("381 Studios");
  });

  it("no og:image size tags when dimensions unknown; encodes the cover id", () => {
    const m = galleryMeta(
      openData({ og: { coverId: "a/b", width: null, height: null } }),
      base,
    ) as Record<string, string>[];
    expect(find(m, "og:image")).toBe(`${ORIGIN}/img/a%2Fb/view-sm`);
    expect(find(m, "og:image:width")).toBeUndefined();
  });

  it("public gallery without a cover: title/description but no image", () => {
    const m = galleryMeta(
      openData({ og: { coverId: null, width: null, height: null } }),
      base,
    ) as Record<string, string>[];
    expect(find(m, "og:title")).toBe("Boda Ana");
    expect(find(m, "og:image")).toBeUndefined();
    expect(find(m, "twitter:card", "name")).toBe("summary");
  });

  it("PIN gallery (og null): generic meta even when opened", () => {
    const m = galleryMeta(openData({ og: null }), base) as Record<
      string,
      string
    >[];
    expect(find(m, "og:title")).toBe("381 Studios");
    expect(find(m, "og:image")).toBeUndefined();
    expect(JSON.stringify(m.filter((x) => !("title" in x)))).not.toContain(
      "Boda",
    );
  });

  it.each([
    [
      "locked",
      { state: "locked", slug: "s", title: "SECRET TITLE", palette: "claro" },
    ],
    ["unavailable", { state: "unavailable" }],
    ["unknown/undefined", undefined],
  ])("%s: generic meta, no title leak, no image", (_n, data) => {
    const m = galleryMeta(data as never, base) as Record<string, string>[];
    const json = JSON.stringify(m);
    expect(json).not.toContain("SECRET");
    expect(find(m, "og:image")).toBeUndefined();
    expect(find(m, "og:title")).toBe("381 Studios");
    expect(find(m, "og:description")).toBe("381 Studios");
    expect(find(m, "og:url")).toBeUndefined();
    expect(m.find((x) => "title" in x)).toEqual({ title: "381 Studios" });
  });

  it("locked and unavailable produce identical meta", () => {
    expect(
      JSON.stringify(
        galleryMeta(
          {
            state: "locked",
            slug: "x",
            title: "x",
            palette: "oscuro",
          } as never,
          base,
        ),
      ),
    ).toBe(
      JSON.stringify(galleryMeta({ state: "unavailable" } as never, base)),
    );
  });
});
