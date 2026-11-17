import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { ipv6Prefix64 } from "../app/lib/server/access";
import { hashPin } from "../app/lib/server/crypto";
import { galleryAction } from "../app/lib/server/admin-galleries";
import {
  handleListFavorites,
  handleSetFavorite,
  handleVisitor,
} from "../app/lib/server/favorites";
import {
  PIN_GALLERY_MAX_ATTEMPTS,
  PIN_MAX_ATTEMPTS,
  unlockGallery,
} from "../app/lib/server/gallery";
import { favoritesData } from "../app/routes/admin.g.$id.favorites";
import { txtResponse } from "../app/routes/admin.g.$id.favorites-txt";
import { activityData } from "../app/routes/admin.g.$id.activity";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const G = "00000000-0000-4000-8000-0000000000e1";

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});

async function reset() {
  await env.DB.batch(
    [
      "downloads",
      "favorites",
      "gallery_views",
      "visitors",
      "photos",
      "rate_limits",
      "galleries",
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
}

describe("ipv6Prefix64", () => {
  it.each([
    ["2001:db8::1", "2001:0db8:0000:0000::/64"],
    ["2001:db8:0:0:ffff:ffff:ffff:ffff", "2001:0db8:0000:0000::/64"],
    ["2001:DB8:0:0::5", "2001:0db8:0000:0000::/64"],
    ["2001:db8:1:2:3:4:5:6", "2001:0db8:0001:0002::/64"],
    ["::1", "0000:0000:0000:0000::/64"],
    ["::ffff:1.2.3.4", "1.2.3.4"],
    ["::ffff:102:304", "1.2.3.4"],
    ["64:ff9b::1.2.3.4", "1.2.3.4"],
    ["fe80::1%eth0", "fe80:0000:0000:0000::/64"],
  ])("%s", (ip, out) => expect(ipv6Prefix64(ip)).toBe(out));
  it("leaves IPv4 and garbage alone", () => {
    expect(ipv6Prefix64("203.0.113.9")).toBe("203.0.113.9");
    expect(ipv6Prefix64("local")).toBe("local");
    expect(ipv6Prefix64("1:2:3")).toBe("1:2:3");
  });
});

describe("PIN limiter", () => {
  const post = (pin: string, ip: string) => {
    const body = new FormData();
    body.set("pin", pin);
    return new Request("https://s.test/boda", {
      method: "POST",
      body,
      headers: { "CF-Connecting-IP": ip },
    });
  };
  beforeEach(async () => {
    await reset();
    await db.insert(schema.galleries).values({
      id: "gP",
      driveFolderId: "f",
      slug: "boda",
      title: "B",
      status: "published",
      pinHash: await hashPin("1234"), // legacy short PIN keeps working
    });
  });

  it("a legacy 4-char PIN still unlocks", async () => {
    expect(
      (await unlockGallery(post("1234", "1.1.1.1"), "boda", env)).status,
    ).toBe(303);
  });
  it("per-IP: rotating addresses inside one IPv6 /64 shares one budget", async () => {
    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) {
      const r = await unlockGallery(
        post("0000", `2001:db8:0:0::${i + 1}`),
        "boda",
        env,
      );
      expect(r.status).toBe(400);
    }
    const r = await unlockGallery(
      post("1234", "2001:db8:0:0:aaaa::9"),
      "boda",
      env,
    );
    expect(r.status).toBe(429);
  });
  it("a different /64 has its own per-IP budget", async () => {
    for (let i = 0; i < PIN_MAX_ATTEMPTS + 1; i++)
      await unlockGallery(post("0000", `2001:db8:0:0::${i + 1}`), "boda", env);
    expect(
      (await unlockGallery(post("1234", "2001:db8:0:1::1"), "boda", env))
        .status,
    ).toBe(303);
  });
  it("per-gallery: PIN_GALLERY_MAX_ATTEMPTS wrong guesses from many IPs lock everyone", async () => {
    expect(PIN_GALLERY_MAX_ATTEMPTS).toBe(100);
    await env.DB.prepare(
      "INSERT INTO rate_limits (key, count, window_start) VALUES ('pinG:gP', 100, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
    ).run();
    expect(
      (await unlockGallery(post("1234", "9.9.9.9"), "boda", env)).status,
    ).toBe(429);
  });
  it("a correct PIN clears the gallery counter", async () => {
    await env.DB.prepare(
      "INSERT INTO rate_limits (key, count, window_start) VALUES ('pinG:gP', 99, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
    ).run();
    expect(
      (await unlockGallery(post("1234", "8.8.8.8"), "boda", env)).status,
    ).toBe(303);
    const row = await env.DB.prepare(
      "SELECT 1 AS x FROM rate_limits WHERE key = 'pinG:gP'",
    ).first();
    expect(row).toBeNull();
  });
});

describe("admin PIN length", () => {
  const act = (fields: Record<string, string>) => {
    return galleryAction(
      new Request(`http://localhost/admin/g/${G}`, {
        method: "POST",
        body: new URLSearchParams(fields),
      }),
      e,
      G,
    );
  };
  beforeEach(async () => {
    await reset();
    await db.insert(schema.galleries).values({
      id: G,
      driveFolderId: "fx",
      slug: "x",
      title: "X",
      status: "published",
    });
  });
  it("rejects 5-character PINs", async () => {
    const r = await act({ intent: "pin", mode: "set", pin: "12345" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("6");
  });
  it("accepts 6-character PINs", async () => {
    expect((await act({ intent: "pin", mode: "set", pin: "123456" })).ok).toBe(
      true,
    );
  });
});

describe("per-device visitors", () => {
  const post = (path: string, body: unknown, ip: string, cookie?: string) =>
    new Request(`https://s.test${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": ip,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  const ck = (r: Response) => (r.headers.get("Set-Cookie") ?? "").split(";")[0];
  const reg = (body: unknown, ip: string, cookie?: string) =>
    handleVisitor(post("/api/g/boda/visitor", body, ip, cookie), "boda", env);
  const emailRows = () =>
    env.DB.prepare(
      "SELECT id, email, name FROM visitors WHERE gallery_id = 'gV' ORDER BY first_seen, id",
    ).all<{
      id: string;
      email: string;
      name: string | null;
    }>();

  beforeEach(async () => {
    await reset();
    await db.insert(schema.galleries).values({
      id: "gV",
      driveFolderId: "f",
      slug: "boda",
      title: "B",
      status: "published",
    });
    await db.insert(schema.photos).values({
      id: "p1",
      galleryId: "gV",
      baseName: "A",
      driveHighresId: "h",
      sort: 1,
    });
  });

  it("allows the same email on several rows (unique index dropped)", async () => {
    await reg({ email: "a@x.com" }, "1.1.1.1");
    await reg({ email: "a@x.com" }, "2.2.2.2");
    expect((await emailRows()).results.length).toBe(2);
  });
  it("response is exactly {ok:true}, never a stored name or email", async () => {
    const first = await reg({ email: "a@x.com", name: "Alice" }, "1.1.1.1");
    expect(await first.json()).toEqual({ ok: true });
    const second = await reg({ email: "a@x.com" }, "2.2.2.2");
    expect(await second.json()).toEqual({ ok: true });
  });
  it("a session with a visitor updates it instead of creating another", async () => {
    const r1 = await reg({ email: "a@x.com", name: "Alice" }, "1.1.1.1");
    const cookie = ck(r1);
    const r2 = await reg({ email: "b@x.com", name: "Bea" }, "1.1.1.1", cookie);
    expect(r2.status).toBe(200);
    const rows = (await emailRows()).results;
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ email: "b@x.com", name: "Bea" });
  });
  it("update without a name keeps the existing name", async () => {
    const cookie = ck(
      await reg({ email: "a@x.com", name: "Alice" }, "1.1.1.1"),
    );
    await reg({ email: "c@x.com" }, "1.1.1.1", cookie);
    expect((await emailRows()).results[0]).toMatchObject({
      email: "c@x.com",
      name: "Alice",
    });
  });
  it("an anonymous favouriter who then types an email keeps their favourites", async () => {
    const anon = await handleSetFavorite(
      post("/api/g/boda/favorites", { photoId: "p1", on: true }, "1.1.1.1"),
      "boda",
      { ...env, DRIVE_MODE: "mock" } as Env,
    );
    // requireEmail defaults to true, so anon favourites are refused: turn it off.
    expect(anon.status).toBe(403);
    await db.update(schema.galleries).set({ requireEmail: false });
    const ok = await handleSetFavorite(
      post("/api/g/boda/favorites", { photoId: "p1", on: true }, "1.1.1.1"),
      "boda",
      env,
    );
    const cookie = ck(ok);
    await reg({ email: "a@x.com" }, "1.1.1.1", cookie);
    const list = await handleListFavorites(
      new Request("https://s.test/api/g/boda/favorites", {
        headers: { Cookie: cookie, "CF-Connecting-IP": "1.1.1.1" },
      }),
      "boda",
      env,
    );
    expect(await list.json()).toMatchObject({
      visitor: { email: "a@x.com" },
      favorites: ["p1"],
    });
  });
  it("rate limit still applies to new visitors", async () => {
    let last = 200;
    for (let i = 0; i < 31; i++)
      last = (await reg({ email: `u${i}@x.com` }, "5.5.5.5")).status;
    expect(last).toBe(429);
  });

  describe("admin groups per lower(email)", () => {
    beforeEach(async () => {
      await db.insert(schema.visitors).values([
        { id: "d1", galleryId: "gV", email: "ana@x.com" },
        { id: "d2", galleryId: "gV", email: "ana@x.com" },
        { id: "d3", galleryId: "gV", email: "Ana@X.com" },
        { id: "d4", galleryId: "gV", email: "bob@x.com" },
        { id: "da", galleryId: "gV", email: "anon-1@anon.invalid" },
      ]);
      await db.insert(schema.photos).values({
        id: "p2",
        galleryId: "gV",
        baseName: "B",
        driveHighresId: "h2",
        sort: 2,
      });
      await db.insert(schema.favorites).values([
        { galleryId: "gV", visitorId: "d1", photoId: "p1" },
        { galleryId: "gV", visitorId: "d2", photoId: "p1" },
        { galleryId: "gV", visitorId: "d2", photoId: "p2" },
        { galleryId: "gV", visitorId: "d4", photoId: "p2" },
      ]);
      await db.insert(schema.downloads).values([
        {
          id: "x1",
          galleryId: "gV",
          photoId: "p1",
          visitorId: "d1",
          variant: "web",
          kind: "single",
        },
        {
          id: "x2",
          galleryId: "gV",
          photoId: "p1",
          visitorId: "d2",
          variant: "web",
          kind: "single",
        },
        {
          id: "x3",
          galleryId: "gV",
          photoId: "p2",
          visitorId: "d3",
          variant: "web",
          kind: "single",
        },
      ]);
    });
    const req = (p: string) =>
      new Request(`http://localhost:5173/admin/g/gV/${p}`);

    it("summary counts one visitor per email", async () => {
      const d = await activityData(req("activity"), e, "gV");
      expect(d.summary.visitors).toBe(2);
    });
    it("visitor filter options list each email once", async () => {
      const d = await activityData(req("activity"), e, "gV");
      expect(d.visitorOptions).toEqual(["ana@x.com"]);
    });
    it("filtering by email returns the rows of every device", async () => {
      const d = await activityData(
        new Request(
          "http://localhost:5173/admin/g/gV/activity?visitor=ana@x.com",
        ),
        e,
        "gV",
      );
      expect(d.rows.length).toBe(3);
    });
    it("favourites: one person per email, picks count people not devices", async () => {
      const d = (await favoritesData(req("favorites"), e, "gV"))!;
      expect(d.visitors.map((v) => v.label)).toEqual([
        "ana@x.com",
        "bob@x.com",
      ]);
      const ana = d.visitors[0];
      expect(ana.lists[0].photos.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
      const p1 = d.all.find((p) => p.id === "p1")!;
      const p2 = d.all.find((p) => p.id === "p2")!;
      expect(p1.picks).toBe(1);
      expect(p2.picks).toBe(2);
    });
    it("favorites.txt for an email merges its devices", async () => {
      const res = await txtResponse(
        new Request(
          "http://localhost:5173/admin/g/gV/favorites.txt?visitor=ana%40x.com",
        ),
        e,
        "gV",
      );
      expect((await res.text()).trim().split("\n").sort()).toEqual(["A", "B"]);
    });
  });
});
