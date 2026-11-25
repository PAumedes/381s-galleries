import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { clientAction } from "../app/lib/server/admin-clients";
import { galleryAction } from "../app/lib/server/admin-galleries";
import { accessFingerprint, findGallery } from "../app/lib/server/access";
import { hashPin } from "../app/lib/server/crypto";
import { loadHome } from "../app/lib/server/home";
import { migrateDb, resetTables } from "./support/d1";

// T6.52 adversary fixes: show_on_home stays honest under a client PIN, and a
// removed client PIN cannot revive download links issued before it was set.
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const CA = "cccccccc-0000-0000-0000-0000000000cc";
const BASE = "http://localhost";
let hash = "";

beforeAll(async () => {
  await migrateDb();
  hash = await hashPin("client-pin-1");
});
beforeEach(async () => {
  await resetTables("photos", "galleries", "clients");
});

async function client(over: Partial<typeof schema.clients.$inferInsert> = {}) {
  await db
    .insert(schema.clients)
    .values({ id: CA, slug: "acme", name: "Acme", ...over });
}
async function album(
  id: string,
  over: Partial<typeof schema.galleries.$inferInsert> = {},
) {
  await db.insert(schema.galleries).values({
    id,
    driveFolderId: "f-" + id,
    slug: id,
    title: "T " + id,
    status: "published",
    ...over,
  });
  await db.insert(schema.photos).values({
    id: "p-" + id,
    galleryId: id,
    baseName: "IMG",
    driveHighresId: "hr",
    driveThumbId: "th",
    driveWebId: "w",
    sort: 0,
    width: 3,
    height: 2,
  });
}
const flag = async (id: string) =>
  (
    await env.DB.prepare("SELECT show_on_home h FROM galleries WHERE id = ?1")
      .bind(id)
      .first<{ h: number }>()
  )?.h;
const cl = (b: Record<string, string>) =>
  clientAction(
    new Request(`${BASE}/admin/clients/${CA}`, {
      method: "POST",
      body: new URLSearchParams(b),
    }),
    e,
    CA,
  );
const gal = (id: string, b: Record<string, string>, lang = "es") =>
  galleryAction(
    new Request(`${BASE}/admin/g/${id}?lang=${lang}`, {
      method: "POST",
      headers: { cookie: `admin_lang=${lang}` },
      body: new URLSearchParams(b),
    }),
    e,
    id,
  );

describe("T6.52 hardening: show_on_home honesty", () => {
  it("pinSet turns the flag off on every album of the client (others untouched)", async () => {
    await client();
    await album("a1", { clientId: CA, showOnHome: true });
    await album("a2", { clientId: CA, showOnHome: true });
    await album("z", { showOnHome: true });
    await cl({ intent: "pinSet", pin: "client-pin-1" });
    expect([await flag("a1"), await flag("a2"), await flag("z")]).toEqual([
      0, 0, 1,
    ]);
    await cl({ intent: "pinRemove" });
    expect(JSON.stringify(await loadHome(e))).not.toContain('"a1"');
    expect(JSON.stringify(await loadHome(e))).toContain('"z"');
  });

  it("an owner can turn it on again after the PIN is removed", async () => {
    await client({ pinHash: hash });
    await album("a1", { clientId: CA });
    await cl({ intent: "pinRemove" });
    const r = await gal("a1", { intent: "home", showOnHome: "1" });
    expect(r.ok).toBe(true);
    expect(await flag("a1")).toBe(1);
  });

  it.each(["es", "en"])(
    "saveHome refuses to turn it on for an album of a PIN client (%s)",
    async (lang) => {
      await client({ pinHash: hash });
      await album("a1", { clientId: CA });
      const r = await gal("a1", { intent: "home", showOnHome: "1" }, lang);
      expect(r.ok).toBe(false);
      expect(r.fieldErrors?.showOnHome).toBeTruthy();
      expect(await flag("a1")).toBe(0);
      // same message as for an album with its own PIN
      await album("a2", { pinHash: hash });
      const own = await gal("a2", { intent: "home", showOnHome: "1" }, lang);
      expect(r.fieldErrors?.showOnHome).toBe(own.fieldErrors?.showOnHome);
    },
  );

  it("saveHome can still turn it off", async () => {
    await client({ pinHash: hash });
    await album("a1", { clientId: CA, showOnHome: true });
    expect((await gal("a1", { intent: "home", showOnHome: "0" })).ok).toBe(
      true,
    );
    expect(await flag("a1")).toBe(0);
  });

  it("assigning an album to a PIN client does not copy show_on_home on", async () => {
    await client({ pinHash: hash, defaultShowOnHome: true });
    await album("a1");
    const r = await gal("a1", {
      intent: "details",
      title: "T a1",
      slug: "a1",
      eventDate: "",
      expiresDate: "",
      expiresTime: "",
      clientId: CA,
    });
    expect(r.ok).toBe(true);
    expect(await flag("a1")).toBe(0);
  });

  it("unassigning or deleting a PIN client keeps flag-0 albums off the home", async () => {
    await client({ pinHash: hash, defaultShowOnHome: true });
    await album("a1", { clientId: CA });
    await album("a2", { clientId: CA });
    await cl({ intent: "applyDefaults", confirm: "1" });
    await gal("a1", {
      intent: "details",
      title: "T a1",
      slug: "a1",
      eventDate: "",
      expiresDate: "",
      expiresTime: "",
      clientId: "",
    });
    // delete answers with a redirect (thrown Response)
    await cl({ intent: "delete", slug: "acme" }).catch(() => undefined);
    expect(await flag("a1")).toBe(0);
    expect(await flag("a2")).toBe(0);
    const home = JSON.stringify(await loadHome(e));
    expect(home).not.toContain('"a1"');
    expect(home).not.toContain('"a2"');
  });
});

describe("T6.52 hardening: pin_epoch", () => {
  const fp = async (slug: string) =>
    accessFingerprint((await findGallery(e, slug))!, e);

  it("every set / change / remove increments the epoch", async () => {
    await client();
    const epoch = async () =>
      (
        await db
          .select({ n: schema.clients.pinEpoch })
          .from(schema.clients)
          .where(eq(schema.clients.id, CA))
      )[0]!.n;
    expect(await epoch()).toBe(0);
    await cl({ intent: "pinSet", pin: "client-pin-1" });
    expect(await epoch()).toBe(1);
    await cl({ intent: "pinSet", pin: "client-pin-2" });
    expect(await epoch()).toBe(2);
    await cl({ intent: "pinRemove" });
    expect(await epoch()).toBe(3);
  });

  it("the fingerprint after set+remove differs from the one before, and never-PIN albums are unchanged", async () => {
    await client();
    await album("a1", { clientId: CA });
    await album("a2");
    const before = await fp("a1");
    const plain = await fp("a2");
    await cl({ intent: "pinSet", pin: "client-pin-1" });
    const during = await fp("a1");
    await cl({ intent: "pinRemove" });
    const after = await fp("a1");
    expect(new Set([before, during, after]).size).toBe(3);
    expect(plain).toBe(await fp("a2"));
  });

  it("a failed set (invalid PIN) does not touch the epoch", async () => {
    await client();
    await cl({ intent: "pinSet", pin: "x" });
    expect(
      (await env.DB.prepare("SELECT pin_epoch n FROM clients").first<{
        n: number;
      }>())!.n,
    ).toBe(0);
  });
});
