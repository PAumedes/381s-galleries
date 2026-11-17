import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { cardData, headers } from "../app/routes/admin.g.$id.card";
import { editData } from "../app/routes/admin.g.$id";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const nonAdmin = { ...e, ALLOW_DEV_ADMIN: "0" } as Env;
const db = getDb(env);
const ID = "00000000-0000-4000-8000-0000000000c1";

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.insert(schema.galleries).values({
    id: ID,
    driveFolderId: "drive-folder-secret",
    slug: "boda-ana",
    title: "Boda Ana",
    status: "draft",
    eventDate: "2026-11-01",
    pinHash: "pbkdf2$100000$aaa$bbb",
  });
});

const req = (q = "") =>
  new Request(`http://localhost:5173/admin/g/${ID}/card${q}`);
const status = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (x) {
    return (x as Response).status;
  }
  return 200;
};

describe("card route loader", () => {
  it("401 for non-admin, 404 unknown", async () => {
    expect(await status(cardData(req(), nonAdmin, ID))).toBe(401);
    expect(await status(cardData(req(), e, "nope"))).toBe(404);
  });
  it("returns public url from canonical origin, no pin hash, no drive id", async () => {
    const d = await cardData(req(), e, ID);
    expect(d.url).toBe("https://gallery.381studios.ar/boda-ana");
    expect(d.title).toBe("Boda Ana");
    expect(d.hasPin).toBe(true);
    expect(d.lang).toBe("es");
    const s = JSON.stringify(d);
    expect(s).not.toContain("pbkdf2");
    expect(s).not.toContain("secret");
  });
  it("?lang=en switches, unknown falls back to es", async () => {
    expect((await cardData(req("?lang=en"), e, ID)).lang).toBe("en");
    expect((await cardData(req("?lang=xx"), e, ID)).lang).toBe("es");
  });
  it("is noindex and no-store", () => {
    const h = headers() as Record<string, string>;
    expect(h["X-Robots-Tag"]).toMatch(/noindex/);
    expect(h["Cache-Control"]).toMatch(/no-store/);
  });
  it("edit loader exposes the canonical origin for the share URL", async () => {
    const d = await editData(req(), e, ID);
    expect(d.origin).toBe("https://gallery.381studios.ar");
  });
});
