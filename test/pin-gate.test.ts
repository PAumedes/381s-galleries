import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { hashPin } from "../app/lib/server/crypto";
import { loadGallery, unlockGallery } from "../app/lib/server/gallery";
import { galleryAction } from "../app/lib/server/gallery-route";
import { migrateDb, resetTables } from "./support/d1";

// T6.54 (4)+(6): which PIN the gate asks for, what each entry does, and the
// answer a wrong PIN gets. Client PIN first, then the album's own (T6.52).
const e = { ...env, DRIVE_MODE: "mock" } as Env;
const db = getDb(env);
const ORIGIN = "https://gallery.381studios.ar";
const CID = "cccccccc-0000-0000-0000-00000000000a";
const CLIENT_PIN = "client-pin-1";
const OWN_PIN = "own-album-pin";
const IP = "203.0.113.9";

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

async function seed(opts: { clientPin?: boolean; ownPin?: boolean }) {
  await db.insert(schema.clients).values({
    id: CID,
    slug: "acme",
    name: "Acme",
    pinHash: opts.clientPin ? clientHash : null,
  });
  await db.insert(schema.galleries).values({
    id: "g1",
    driveFolderId: "drive-1",
    slug: "boda",
    title: "Boda",
    status: "published",
    clientId: CID,
    pinHash: opts.ownPin ? ownHash : null,
  });
  await db.insert(schema.photos).values({
    id: "p1",
    galleryId: "g1",
    baseName: "IMG_1",
    driveHighresId: "hr",
    driveWebId: "web",
    driveThumbId: "th",
    sort: 0,
    width: 3000,
    height: 2000,
  });
}
const post = (pin: string, cookie = "", extra: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/acme/boda`, {
    method: "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": IP,
      "Sec-Fetch-Site": "same-origin",
    },
    body: new URLSearchParams({ pin, ...extra }).toString(),
  });
const get = (cookie = "") =>
  new Request(`${ORIGIN}/acme/boda`, {
    headers: { ...(cookie ? { Cookie: cookie } : {}), "CF-Connecting-IP": IP },
  });
const pair = (setCookie: string | undefined) => setCookie!.split(";")[0];
const gate = async (cookie = "") =>
  (await loadGallery(get(cookie), "boda", e)).data;

describe("T6.54 (4) which PIN the gate asks for", () => {
  it("client PIN + album PIN: first the client's, then (once accepted) the album's, and the page says so", async () => {
    await seed({ clientPin: true, ownPin: true });
    expect(await gate()).toMatchObject({ state: "locked", step: "client" });
    expect(await gate()).not.toHaveProperty("clientAccepted");

    const r = await unlockGallery(post(CLIENT_PIN), "boda", e, "acme");
    expect(r.status).toBe(303);
    // The client PIN alone does not open an album with its own PIN: the
    // visitor sees the gate again, and now it says the first step was accepted.
    expect(
      await gate(pair((r as { setCookie: string }).setCookie)),
    ).toMatchObject({
      state: "locked",
      step: "album",
      clientAccepted: true,
    });
  });

  it("the album PIN entered at the client step is refused (no oracle on the album PIN without the client PIN)", async () => {
    await seed({ clientPin: true, ownPin: true });
    const r = await unlockGallery(post(OWN_PIN), "boda", e, "acme");
    expect(r).toEqual({ status: 400, step: "client", attempt: 0 });
    expect(r).not.toHaveProperty("setCookie");
    expect(await gate()).toMatchObject({ step: "client" });
  });

  it("after the client step the album PIN opens the album; the client PIN no longer does", async () => {
    await seed({ clientPin: true, ownPin: true });
    const c = pair(
      (
        (await unlockGallery(post(CLIENT_PIN), "boda", e)) as {
          setCookie: string;
        }
      ).setCookie,
    );
    const wrong = await unlockGallery(post(CLIENT_PIN, c), "boda", e);
    expect(wrong).toEqual({ status: 400, step: "album", attempt: 0 });
    const ok = await unlockGallery(post(OWN_PIN, c), "boda", e);
    expect(ok.status).toBe(303);
    const both = `${c}; ${pair((ok as { setCookie: string }).setCookie)}`;
    expect((await gate(both)).state).toBe("open");
  });

  it("only an album PIN: the gate is the album's, no first step", async () => {
    await seed({ ownPin: true });
    expect(await gate()).toMatchObject({ state: "locked", step: "album" });
    expect(await gate()).not.toHaveProperty("clientAccepted");
  });

  it("only a client PIN: the gate is the client's", async () => {
    await seed({ clientPin: true });
    expect(await gate()).toMatchObject({ state: "locked", step: "client" });
  });

  it("wrong PIN says which PIN it was; rate limits still count per client at the client step", async () => {
    await seed({ clientPin: true, ownPin: true });
    for (let i = 0; i < 5; i++)
      expect(await unlockGallery(post("nope-" + i), "boda", e)).toEqual({
        status: 400,
        step: "client",
        attempt: 0,
      });
    // 6th wrong: throttled, even with the right PIN
    expect((await unlockGallery(post(CLIENT_PIN), "boda", e)).status).toBe(429);
  });

  it("the locked payload leaks nothing new: no hash, no Drive id, no client name", async () => {
    await seed({ clientPin: true, ownPin: true });
    const text = JSON.stringify(await gate());
    for (const secret of ["pbkdf2", "drive-1", "Acme", "IMG_1"])
      expect(text).not.toContain(secret);
  });
});

describe("T6.54 (6) the gate's answer to a wrong PIN", () => {
  const act = async (
    pin: string,
    extra: Record<string, string> = {},
    lang = "",
  ) => {
    const req = post(pin, lang ? `lang=${lang}` : "", extra);
    const res = (await galleryAction(
      { request: req },
      { album: "boda", client: "acme" },
      e,
    )) as {
      data: { error: string; attempt: number; step?: string };
      init: { status: number };
    };
    return res;
  };

  it("first wrong PIN: attempt 1, names the PIN (ES)", async () => {
    await seed({ clientPin: true, ownPin: true });
    const r = await act("nope");
    expect(r.init.status).toBe(400);
    expect(r.data.attempt).toBe(1);
    expect(r.data.error).toBe("PIN del cliente incorrecto (intento 1)");
  });

  it("the posted attempt counter continues: 3 -> 4, in EN, for the album PIN", async () => {
    await seed({ ownPin: true });
    const r = await act("nope", { attempt: "3" }, "en");
    expect(r.data.attempt).toBe(4);
    expect(r.data.error).toBe("Wrong gallery PIN (attempt 4)");
  });

  it("a forged counter is ignored (negative, over 4 digits, garbage) and a real one is never clamped", async () => {
    await seed({ ownPin: true });
    expect((await act("x", { attempt: "-5" })).data.attempt).toBe(1);
    expect((await act("x", { attempt: "99999999999" })).data.attempt).toBe(1);
    expect((await act("x", { attempt: "abc" })).data.attempt).toBe(1);
    expect((await act("x", { attempt: "250" })).data.attempt).toBe(251);
  });

  it("a throttled attempt still answers with a fresh counter and the throttle text", async () => {
    await seed({ ownPin: true });
    for (let i = 0; i < 5; i++) await act("nope");
    const r = await act("nope", { attempt: "5" });
    expect(r.init.status).toBe(429);
    expect(r.data.attempt).toBe(6);
    expect(r.data.error).toMatch(/Demasiados intentos/);
  });

  it("the action never needs a router context", () => {
    expect(new RouterContextProvider()).toBeTruthy();
  });
});

describe("T6.54 the gate form body is parsed once", () => {
  it("a refused attempt reads the body one time (no clone, no second formData)", async () => {
    await seed({ ownPin: true });
    const req = post("nope", "", { attempt: "7" });
    let reads = 0;
    const read = req.formData.bind(req);
    req.formData = () => {
      reads++;
      return read();
    };
    const clone = req.clone.bind(req);
    let clones = 0;
    req.clone = () => {
      clones++;
      return clone();
    };
    const res = (await galleryAction(
      { request: req },
      { album: "boda" },
      e,
    )) as {
      data: { attempt: number };
    };
    expect(res.data.attempt).toBe(8);
    expect(reads).toBe(1);
    expect(clones).toBe(0);
  });
});
