import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { clientAction, clientEditData } from "../app/lib/server/admin-clients";
import { executionContext } from "../app/lib/server/context";
import { SLUG_LOADER_D1_QUERIES } from "../app/lib/server/d1-limits";
import { hashPin } from "../app/lib/server/crypto";
import {
  PIN_MAX_ATTEMPTS,
  loadGallery,
  unlockGallery,
} from "../app/lib/server/gallery";
import { galleryLoader } from "../app/lib/server/gallery-route";
import { loadHome } from "../app/lib/server/home";
import { serveImage } from "../app/lib/server/images";
import { loadClientPage } from "../app/lib/server/client-page";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv } from "./support/warm";

// T6.52 client PIN: one optional PIN per client opens every album of that
// client for the visitor; an album's own PIN still asks for itself afterwards.
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const ORIGIN = "https://gallery.381studios.ar";
const CA = "cccccccc-0000-0000-0000-00000000000a";
const CB = "cccccccc-0000-0000-0000-00000000000b";
const CLIENT_PIN = "client-pin-1";
const OWN_PIN = "own-album-pin";

let clientHash = "";
let ownHash = "";
beforeAll(async () => {
  await migrateDb();
  clientHash = await hashPin(CLIENT_PIN);
  ownHash = await hashPin(OWN_PIN);
});
beforeEach(() =>
  resetTables("rate_limits", "gallery_views", "photos", "galleries", "clients"),
);

async function addClient(id: string, slug: string, pinHash: string | null) {
  await db
    .insert(schema.clients)
    .values({ id, slug, name: `Name ${slug}`, pinHash });
}
async function addAlbum(
  slug: string,
  clientId: string | null,
  over: Partial<typeof schema.galleries.$inferInsert> = {},
) {
  await db.insert(schema.galleries).values({
    id: `g-${slug}`,
    driveFolderId: `drive-SECRET-${slug}`,
    slug,
    title: `Title ${slug}`,
    status: "published",
    clientId,
    ...over,
  });
  await db.insert(schema.photos).values({
    id: `p-${slug}`,
    galleryId: `g-${slug}`,
    baseName: `IMG_${slug}`,
    driveHighresId: `hr-SECRET-${slug}`,
    driveWebId: `web-SECRET-${slug}`,
    driveThumbId: `th-SECRET-${slug}`,
    sort: 0,
    width: 3000,
    height: 2000,
  });
}
const IP = "203.0.113.7";
const post = (pin: string, ip = IP, cookie = "") =>
  new Request(`${ORIGIN}/x`, {
    method: "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": ip,
      "Sec-Fetch-Site": "same-origin",
    },
    body: new URLSearchParams({ pin }).toString(),
  });
const get = (cookie = "") =>
  new Request(`${ORIGIN}/x`, {
    headers: { ...(cookie ? { Cookie: cookie } : {}), "CF-Connecting-IP": IP },
  });
const jar = (...setCookies: (string | undefined)[]) =>
  setCookies
    .filter(Boolean)
    .map((c) => c!.split(";")[0])
    .join("; ");
const state = async (slug: string, cookie = "") =>
  (await loadGallery(get(cookie), slug, e)).data.state;
/** Unlocks with `pin` and returns the cookie pair to send back. */
async function unlock(slug: string, pin: string, client?: string, cookie = "") {
  const r = await unlockGallery(post(pin, IP, cookie), slug, e, client);
  expect(r.status).toBe(303);
  return jar(r.status === 303 ? r.setCookie : undefined);
}

describe("T6.52 client PIN gate", () => {
  it("an album of a PIN client is locked and its payload is today's gate payload only", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    const r = await loadGallery(get(), "boda", e);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({
      state: "locked",
      slug: "boda",
      title: "Title boda",
      palette: expect.anything(),
      step: "client",
    });
    const text = JSON.stringify(r);
    for (const secret of ["SECRET", "pbkdf2", "Name acme", "IMG_boda"])
      expect(text).not.toContain(secret);
  });

  it("the correct client PIN opens it and every other album of the client", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    await addAlbum("fiesta", CA);
    const cookie = await unlock("boda", CLIENT_PIN, "acme");
    expect(cookie).toMatch(/^c_/);
    expect(await state("boda", cookie)).toBe("open");
    expect(await state("fiesta", cookie)).toBe("open");
  });

  it("a wrong client PIN is a 400 with no cookie; an empty PIN too", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    for (const pin of ["nope", ""]) {
      const r = await unlockGallery(post(pin), "boda", e);
      expect(r.status).toBe(400);
      expect(r).not.toHaveProperty("setCookie");
    }
  });

  it("the unlock cookie is HttpOnly, SameSite=Lax, Path=/ and carries no PIN, hash or Drive id", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    const r = await unlockGallery(post(CLIENT_PIN), "boda", e);
    const set = (r as { setCookie: string }).setCookie;
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    expect(set).toMatch(/Path=\//);
    const payload = atob(
      set
        .split("=")[1]!
        .split(";")[0]!
        .split(".")[0]!
        .replace(/-/g, "+")
        .replace(/_/g, "/"),
    );
    expect(payload).not.toContain(CLIENT_PIN);
    expect(payload).not.toContain("pbkdf2");
  });

  it("a client PIN does not open the albums of another client", async () => {
    await addClient(CA, "acme", clientHash);
    await addClient(CB, "beta", await hashPin("beta-pin-77"));
    await addAlbum("a1", CA);
    await addAlbum("b1", CB);
    const cookie = await unlock("a1", CLIENT_PIN);
    expect(await state("a1", cookie)).toBe("open");
    expect(await state("b1", cookie)).toBe("locked");
  });

  it("a cookie of client A renamed to client B's cookie name does not open B", async () => {
    await addClient(CA, "acme", clientHash);
    await addClient(CB, "beta", await hashPin("beta-pin-77"));
    await addAlbum("b1", CB);
    await addAlbum("a1", CA);
    const [name, value] = (await unlock("a1", CLIENT_PIN)).split("=");
    const renamed = `c_${CB.replace(/-/g, "")}=${value}`;
    expect(name).toBe(`c_${CA.replace(/-/g, "")}`);
    expect(await state("b1", renamed)).toBe("locked");
  });

  it("a tampered or garbage cookie does not open it", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    const name = `c_${CA.replace(/-/g, "")}`;
    const good = (await unlock("boda", CLIENT_PIN)).split("=")[1]!;
    for (const v of ["x", "a.b", good + "A", good.replace(/^./, "Z")])
      expect(await state("boda", `${name}=${v}`)).toBe("locked");
  });

  it("an album without a client or with a client without PIN is unchanged (open)", async () => {
    await addClient(CA, "acme", null);
    await addAlbum("free", CA);
    await addAlbum("solo", null);
    expect(await state("free")).toBe("open");
    expect(await state("solo")).toBe("open");
    const r = await unlockGallery(post("whatever"), "free", e);
    expect(r.status).toBe(303);
    expect(r).not.toHaveProperty("setCookie");
  });
});

describe("T6.52 own PIN precedence", () => {
  it("client PIN first; the album's own PIN is still asked afterwards", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("vip", CA, { pinHash: ownHash });
    await addAlbum("plain", CA);
    // The own PIN is not accepted while the client PIN is pending.
    expect((await unlockGallery(post(OWN_PIN), "vip", e)).status).toBe(400);
    const clientCookie = await unlock("vip", CLIENT_PIN);
    expect(clientCookie).toMatch(/^c_/);
    // The client PIN opens the plain album but NOT the one with its own PIN.
    expect(await state("plain", clientCookie)).toBe("open");
    expect(await state("vip", clientCookie)).toBe("locked");
    // Then the own PIN (the gallery session cookie) opens it.
    const own = await unlock("vip", OWN_PIN, undefined, clientCookie);
    expect(own).toMatch(/^g_/);
    expect(await state("vip", `${clientCookie}; ${own}`)).toBe("open");
    // The own-PIN cookie alone is not enough while the client PIN is pending.
    expect(await state("vip", own)).toBe("locked");
  });

  it("the client PIN does not open an own-PIN album by itself, and the own PIN does not open the others", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("vip", CA, { pinHash: ownHash });
    await addAlbum("plain", CA);
    const clientCookie = await unlock("plain", CLIENT_PIN);
    const own = await unlock("vip", OWN_PIN, undefined, clientCookie);
    expect(await state("plain", own)).toBe("locked");
    expect(await state("vip", clientCookie)).toBe("locked");
  });

  it("an own-PIN album of a client WITHOUT a PIN behaves as before", async () => {
    await addClient(CA, "acme", null);
    await addAlbum("vip", CA, { pinHash: ownHash });
    expect((await unlockGallery(post(CLIENT_PIN), "vip", e)).status).toBe(400);
    const own = await unlock("vip", OWN_PIN);
    expect(own).toMatch(/^g_/);
    expect(await state("vip", own)).toBe("open");
  });
});

describe("T6.52 invalidation", () => {
  it("changing the client PIN invalidates the cookie, even to the same PIN text", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    const cookie = await unlock("boda", CLIENT_PIN);
    await db.update(schema.clients).set({ pinHash: await hashPin(CLIENT_PIN) }); // fresh salt
    expect(await state("boda", cookie)).toBe("locked");
  });

  it("removing the client PIN opens the albums for everyone, and adding one again locks them even with the old cookie", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    const cookie = await unlock("boda", CLIENT_PIN);
    await db.update(schema.clients).set({ pinHash: null });
    expect(await state("boda")).toBe("open");
    await db.update(schema.clients).set({ pinHash: clientHash });
    expect(await state("boda", cookie)).toBe("open"); // same hash: still valid
    await db
      .update(schema.clients)
      .set({ pinHash: await hashPin("other-pin-9") });
    expect(await state("boda", cookie)).toBe("locked");
  });

  it("an album moved to another PIN client is locked again; unassigned it follows its own PIN only", async () => {
    await addClient(CA, "acme", clientHash);
    await addClient(CB, "beta", await hashPin("beta-pin-77"));
    await addAlbum("boda", CA);
    const cookie = await unlock("boda", CLIENT_PIN);
    expect(await state("boda", cookie)).toBe("open");
    await db.update(schema.galleries).set({ clientId: CB }).where(eq0("boda"));
    expect(await state("boda", cookie)).toBe("locked");
    await db
      .update(schema.galleries)
      .set({ clientId: null })
      .where(eq0("boda"));
    expect(await state("boda", cookie)).toBe("open");
    // Unassigned with its own PIN: the old client's cookie does not open it.
    await db
      .update(schema.galleries)
      .set({ pinHash: ownHash })
      .where(eq0("boda"));
    expect(await state("boda", cookie)).toBe("locked");
  });

  it("deleting the client removes the PIN with the row and its albums are no longer gated", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    const form = (b: Record<string, string>) =>
      new Request("http://localhost/admin/clients/" + CA, {
        method: "POST",
        body: new URLSearchParams(b),
      });
    await clientAction(form({ intent: "pinSet", pin: "x" }), e, CA);
    try {
      await clientAction(form({ intent: "delete", slug: "acme" }), e, CA);
    } catch (r) {
      expect((r as Response).status).toBe(303);
    }
    const left = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM clients",
    ).first<{ n: number }>();
    expect(left!.n).toBe(0);
    expect(await state("boda")).toBe("open");
  });
});

const eq0 = (slug: string) => eq(schema.galleries.slug, slug);

describe("T6.52 rate limits (same protections as the album gate)", () => {
  it("5 wrong guesses per visitor then 429; other visitors are not blocked", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++)
      expect((await unlockGallery(post("bad" + i), "boda", e)).status).toBe(
        400,
      );
    expect((await unlockGallery(post(CLIENT_PIN), "boda", e)).status).toBe(429);
    expect(
      (await unlockGallery(post(CLIENT_PIN, "198.51.100.9"), "boda", e)).status,
    ).toBe(303);
  });

  it("the budget belongs to the client, not the album: guessing across albums does not multiply it", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("a1", CA);
    await addAlbum("a2", CA);
    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++)
      await unlockGallery(post("bad" + i), i % 2 ? "a1" : "a2", e);
    expect((await unlockGallery(post("bad"), "a1", e)).status).toBe(429);
    expect((await unlockGallery(post(CLIENT_PIN), "a2", e)).status).toBe(429);
  });

  it("a correct PIN refunds the visitor's counter (4 wrong + ok + 4 wrong stays 400)", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    for (let i = 0; i < PIN_MAX_ATTEMPTS - 1; i++)
      await unlockGallery(post("bad" + i), "boda", e);
    expect((await unlockGallery(post(CLIENT_PIN), "boda", e)).status).toBe(303);
    for (let i = 0; i < PIN_MAX_ATTEMPTS - 1; i++)
      expect((await unlockGallery(post("bad" + i), "boda", e)).status).toBe(
        400,
      );
  });

  it("an already unlocked visitor is never throttled", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    const cookie = await unlock("boda", CLIENT_PIN);
    for (let i = 0; i < PIN_MAX_ATTEMPTS + 2; i++) {
      const req = post("anything");
      req.headers.set("Cookie", cookie);
      expect((await unlockGallery(req, "boda", e)).status).toBe(303);
    }
  });

  it("a wrong client segment never unlocks (404, no cookie)", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    const r = await unlockGallery(post(CLIENT_PIN), "boda", e, "other");
    expect(r.status).toBe(404);
    expect(r).not.toHaveProperty("setCookie");
  });
});

describe("T6.52 what else the gate covers", () => {
  const img = (cookie: string) =>
    serveImage(
      new Request(`${ORIGIN}/img/p-boda/thumb`, {
        headers: cookie ? { Cookie: cookie } : {},
      }),
      { photoId: "p-boda", variant: "thumb" },
      e,
      { waitUntil() {} },
      {} as never,
    );

  it("images of a PIN client's album are 404 without the unlock and served with it", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    expect((await img("")).status).toBe(404);
    const cookie = await unlock("boda", CLIENT_PIN);
    expect((await img(cookie)).status).toBe(302);
    await db.update(schema.clients).set({ pinHash: await hashPin("zzzzzz-1") });
    expect((await img(cookie)).status).toBe(404);
  });

  it("an unlocked PIN-client album carries no link-preview data", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA);
    const cookie = await unlock("boda", CLIENT_PIN);
    const r = await loadGallery(get(cookie), "boda", e);
    expect(r.data).toMatchObject({ state: "open", og: null });
  });

  it("the studio home never lists albums of a PIN client", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA, { showOnHome: true });
    await addAlbum("solo", null, { showOnHome: true });
    expect((await loadHome(e)).items.map((i) => i.slug)).toEqual(["solo"]);
  });

  it("the client page still lists every album, locked (no cover, no date) because the PIN protects covers", async () => {
    await addClient(CA, "acme", clientHash);
    await addAlbum("boda", CA, { eventDate: "2026-01-02" });
    await addAlbum("vip", CA, { pinHash: ownHash });
    const page = await loadClientPage(e, "acme");
    const items = page!.items;
    expect(items.map((i) => i.slug).sort()).toEqual(["boda", "vip"]);
    for (const i of items) {
      expect(i.locked).toBe(true);
      expect(i.cover).toBeNull();
      expect(i.eventDate).toBeNull();
    }
    const text = JSON.stringify(page);
    expect(text).not.toContain("pbkdf2");
    expect(text).not.toContain("SECRET");
  });

  it("without a client PIN the client page is unchanged: only own-PIN albums are locked", async () => {
    await addClient(CA, "acme", null);
    await addAlbum("boda", CA);
    await addAlbum("vip", CA, { pinHash: ownHash });
    const items = (await loadClientPage(e, "acme"))!.items;
    expect(items.find((i) => i.slug === "boda")?.locked).toBeUndefined();
    expect(items.find((i) => i.slug === "vip")?.locked).toBe(true);
  });
});

describe("T6.52 D1 budget", () => {
  const ctx = () => {
    const c = new RouterContextProvider();
    c.set(executionContext, {
      waitUntil() {},
      passThroughException() {},
    } as never);
    return c;
  };
  async function queries(cookie: string) {
    const c = countingEnv(e);
    await galleryLoader(
      {
        request: new Request(`${ORIGIN}/acme/boda`, {
          headers: {
            ...(cookie ? { Cookie: cookie } : {}),
            "Sec-Fetch-Mode": "navigate",
          },
        }),
        context: ctx(),
      } as never,
      { client: "acme", album: "boda" },
      c.e,
    );
    return c.count();
  }

  it("the loader costs the same with and without a client PIN, locked or open, within the constant", async () => {
    await addClient(CA, "acme", null);
    await addAlbum("boda", CA);
    const base = await queries("");
    await db.update(schema.clients).set({ pinHash: clientHash });
    const locked = await queries("");
    const cookie = await (async () => {
      const r = await unlockGallery(post(CLIENT_PIN), "boda", e);
      return jar((r as { setCookie?: string }).setCookie);
    })();
    const open = await queries(cookie);
    expect(locked).toBeLessThanOrEqual(base);
    expect(open).toBeLessThanOrEqual(SLUG_LOADER_D1_QUERIES);
    expect(open).toBe(base); // the client PIN adds no query (same join)
  });
});

describe("T6.52 admin set / change / remove", () => {
  const form = (b: Record<string, string>) =>
    new Request("http://localhost/admin/clients/" + CA, {
      method: "POST",
      body: new URLSearchParams(b),
    });
  const run = (b: Record<string, string>) => clientAction(form(b), e, CA);
  const pinHash = async () =>
    (
      await env.DB.prepare("SELECT pin_hash FROM clients WHERE id = ?1")
        .bind(CA)
        .first<{ pin_hash: string | null }>()
    )?.pin_hash ?? null;

  it("sets a PIN: stored as a pbkdf2 hash, never plain; the message never echoes it", async () => {
    await addClient(CA, "acme", null);
    const r = await run({ intent: "pinSet", pin: "my-secret-pin" });
    expect(r).toMatchObject({ ok: true, intent: "pinSet" });
    expect(JSON.stringify(r)).not.toContain("my-secret-pin");
    const h = await pinHash();
    expect(h).toMatch(/^pbkdf2\$/);
    expect(h).not.toContain("my-secret-pin");
  });

  it("same rules as the album PIN: 6..32 chars, no control characters", async () => {
    await addClient(CA, "acme", null);
    for (const pin of [
      "12345",
      "x".repeat(33),
      "ab\ncdef",
      "ab\u0000cdef",
      "",
    ]) {
      const r = await run({ intent: "pinSet", pin });
      expect(r).toMatchObject({ ok: false, intent: "pinSet" });
      expect((r as { fieldErrors?: object }).fieldErrors).toHaveProperty("pin");
    }
    expect(await pinHash()).toBeNull();
    for (const pin of ["123456", "x".repeat(32)]) {
      expect(await run({ intent: "pinSet", pin })).toMatchObject({
        ok: true,
      });
    }
  });

  it("changing the PIN replaces the hash; removing clears it; an unknown client is a 404", async () => {
    await addClient(CA, "acme", clientHash);
    await run({ intent: "pinSet", pin: "another-pin-1" });
    const second = await pinHash();
    expect(second).not.toBe(clientHash);
    expect(await run({ intent: "pinRemove" })).toMatchObject({
      ok: true,
    });
    expect(await pinHash()).toBeNull();
    await expect(
      clientAction(form({ intent: "pinSet", pin: "123456" }), e, "nope"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("the save intent and apply-defaults leave the PIN untouched", async () => {
    await addClient(CA, "acme", clientHash);
    await run({
      intent: "save",
      name: "New name",
      slug: "acme",
      defaultMode: "delivery",
    });
    expect(await pinHash()).toBe(clientHash);
  });

  it("the edit loader exposes only hasPin, never the hash", async () => {
    await addClient(CA, "acme", clientHash);
    const d = await clientEditData(
      new Request("http://localhost/admin/clients/" + CA),
      e,
      CA,
    );
    expect(d.client).toMatchObject({ hasPin: true });
    expect(JSON.stringify(d)).not.toContain("pbkdf2");
    await db.update(schema.clients).set({ pinHash: null });
    const d2 = await clientEditData(
      new Request("http://localhost/admin/clients/" + CA),
      e,
      CA,
    );
    expect(d2.client.hasPin).toBe(false);
  });

  it("after the admin sets a PIN the albums are locked at once; removing opens them", async () => {
    await addClient(CA, "acme", null);
    await addAlbum("boda", CA);
    expect(await state("boda")).toBe("open");
    await run({ intent: "pinSet", pin: "fresh-pin-1" });
    expect(await state("boda")).toBe("locked");
    await run({ intent: "pinRemove" });
    expect(await state("boda")).toBe("open");
  });
});
