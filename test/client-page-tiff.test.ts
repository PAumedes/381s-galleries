import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, nowIso, schema } from "../app/db";
import { clientEditData } from "../app/lib/server/admin-clients";
import { hashPin } from "../app/lib/server/crypto";
import { executionContext } from "../app/lib/server/context";
import { CLIENT_PAGE_D1_QUERIES } from "../app/lib/server/d1-limits";
import { galleryLoader } from "../app/lib/server/gallery-route";
import { loadClientTiles, loadHome } from "../app/lib/server/home";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv } from "./support/warm";

// T6.53d2: an album whose photos are ALL TIFF-only without a web JPEG has no
// cover; the CLIENT page still lists it as a title-only tile (the studio home
// does not).
const db = getDb(env);
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const ORIGIN = "https://gallery.381studios.ar";
const past = "2000-01-01T00:00:00.000Z";

const ctx = () => {
  const c = new RouterContextProvider();
  c.set(executionContext, {
    waitUntil() {},
    passThroughException() {},
  } as never);
  return c;
};

type Photo = Partial<typeof schema.photos.$inferInsert>;
const tiff = (id: string): Photo => ({
  id,
  driveHighresId: `TIFF-SECRET-${id}`,
  driveTiffId: `TIFF-SECRET-${id}`,
});
const jpeg = (id: string, over: Photo = {}): Photo => ({
  id,
  driveHighresId: `hr-${id}`,
  ...over,
});

async function album(
  slug: string,
  photos: Photo[],
  over: Partial<typeof schema.galleries.$inferInsert> = {},
  clientId: string | null = "c-acme",
) {
  const id = `g-${slug}`;
  await db.insert(schema.galleries).values({
    id,
    driveFolderId: `drive-SECRET-${slug}`,
    slug,
    title: `Title ${slug}`,
    eventDate: "2026-04-02",
    status: "published",
    showOnHome: true,
    clientId,
    ...over,
  });
  let i = 0;
  for (const p of photos)
    await db.insert(schema.photos).values({
      galleryId: id,
      baseName: `IMG_${slug}_${i}`,
      sort: i++,
      width: 3000,
      height: 2000,
      ...p,
    } as typeof schema.photos.$inferInsert);
}

type Tile = {
  slug: string;
  cover: unknown;
  locked?: boolean;
  tiffOnly?: boolean;
  eventDate: string | null;
};
async function items(): Promise<Tile[]> {
  return (await loadClientTiles(e, "acme"))!.tiles as Tile[];
}

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("photos", "galleries", "clients");
  await db.insert(schema.clients).values([
    { id: "c-acme", slug: "acme", name: "ACME Corp" },
    {
      id: "c-pin",
      slug: "pinned",
      name: "Pinned",
      pinHash: await hashPin("123456"),
    },
  ]);
});

describe("T6.53d2 TIFF-only albums on the client page", () => {
  it("lists an all-TIFF album as a title-only tile: no cover, not locked, normal date, flagged", async () => {
    await album("final", [tiff("t1"), tiff("t2")]);
    const [t] = await items();
    expect(t).toMatchObject({
      slug: "final",
      cover: null,
      eventDate: "2026-04-02",
      tiffOnly: true,
    });
    expect(t.locked).toBeUndefined();
    const json = JSON.stringify(await loadClientTiles(e, "acme"));
    expect(json).not.toContain("SECRET");
  });

  it("the studio home keeps its rules: no cover, not listed", async () => {
    await album("final", [tiff("t1")]);
    expect((await loadHome(e)).items.map((i) => i.slug)).toEqual([]);
  });

  it("a photo with a web JPEG (even beside TIFFs) gives a normal tile with a cover and no flag", async () => {
    await album("mixed", [tiff("t1"), jpeg("j1", { driveWebId: "web1" })]);
    const [t] = await items();
    expect(t.cover).not.toBeNull();
    expect(t.tiffOnly).toBeUndefined();
  });

  it("a TIFF-only photo with a web JPEG is a normal album (it has a preview)", async () => {
    await album("web", [{ ...tiff("t1"), driveWebId: "web1" }]);
    const [t] = await items();
    expect(t.cover).not.toBeNull();
    expect(t.tiffOnly).toBeUndefined();
  });

  it("a coverless album that is not all TIFF stays unlisted (no photos, only missing photos, non-TIFF photo without wm in Prueba)", async () => {
    await album("empty", []);
    await album("gone", [{ ...tiff("t1"), missingSince: nowIso() }]);
    await album("pr", [jpeg("j1")], { mode: "proofing" });
    await album("mixedpr", [tiff("t2"), jpeg("j2")], { mode: "proofing" });
    expect((await loadClientTiles(e, "acme"))?.tiles ?? []).toEqual([]);
  });

  it("a missing photo does not stop the rest from being all TIFF", async () => {
    await album("a", [tiff("t1"), { ...jpeg("j1"), missingSince: nowIso() }]);
    expect((await items()).map((i) => i.slug)).toEqual(["a"]);
  });

  it("Prueba: all TIFF-only (no preview-wm) is listed too", async () => {
    await album("pr", [tiff("t1")], { mode: "proofing" });
    expect((await items())[0]).toMatchObject({ slug: "pr", tiffOnly: true });
  });

  it("keeps the other rules: draft, archived, expired and disabled page are not listed", async () => {
    await album("draft", [tiff("t1")], { status: "draft" });
    await album("arch", [tiff("t2")], { status: "archived" });
    await album("exp", [tiff("t3")], { expiresAt: past });
    await album("ok", [tiff("t4")], { showOnHome: false });
    expect((await items()).map((i) => i.slug)).toEqual(["ok"]);
    await db
      .update(schema.clients)
      .set({ pageEnabled: false })
      .where(eqId("c-acme"));
    expect(await loadClientTiles(e, "acme")).toBeNull();
  });

  it("an album PIN or a client PIN locks the tile exactly as today: no date, no flag", async () => {
    await album("own", [tiff("t1")], { pinHash: await hashPin("123456") });
    await album("byclient", [tiff("t2")], {}, "c-pin");
    const own = (await items())[0];
    expect(own).toMatchObject({
      slug: "own",
      cover: null,
      eventDate: null,
      locked: true,
    });
    expect(own.tiffOnly).toBeUndefined();
    const via = (await loadClientTiles(e, "pinned"))!.tiles[0] as Tile;
    expect(via).toMatchObject({ locked: true, eventDate: null, cover: null });
    expect(via.tiffOnly).toBeUndefined();
  });

  it("paging: the listable filter comes first (TIFF albums count, expired ones do not)", async () => {
    for (let i = 0; i < 61; i++)
      await album(`a${String(i).padStart(2, "0")}`, [tiff(`t${i}`)], {
        eventDate: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      });
    await album("exp", [tiff("tx")], { expiresAt: past });
    const p1 = (await loadClientTiles(e, "acme"))!;
    expect(p1.pageCount).toBe(2);
    expect(p1.tiles).toHaveLength(60);
    expect((await loadClientTiles(e, "acme", 2))!.tiles).toHaveLength(1);
  });

  it("costs the same D1 queries as any client page", async () => {
    await album("final", [tiff("t1")]);
    await album("normal", [jpeg("j1")]);
    const c = countingEnv(e);
    const r = (await galleryLoader(
      {
        request: new Request(`${ORIGIN}/acme`, {
          headers: { "Sec-Fetch-Mode": "navigate" },
        }),
        context: ctx(),
      } as never,
      { album: "acme" },
      c.e,
    )) as { data: { state: string; items: Tile[] } };
    expect(r.data.state).toBe("client");
    expect(r.data.items.map((i) => i.slug).sort()).toEqual(["final", "normal"]);
    expect(c.count()).toBe(CLIENT_PAGE_D1_QUERIES);
  });

  it("the admin client page counts it as listed", async () => {
    await album("final", [tiff("t1")]);
    await album("normal", [jpeg("j1")]);
    await album("draft", [tiff("t2")], { status: "draft" });
    const admin = await clientEditData(
      new Request("http://localhost/x"),
      e,
      "c-acme",
    );
    expect(admin.publicPage.visible).toBe(2);
  });

  it("the album's back-to-client link is offered (it is listed on the client page)", async () => {
    await album("final", [tiff("t1")]);
    const r = (await galleryLoader(
      {
        request: new Request(`${ORIGIN}/acme/final`, {
          headers: { "Sec-Fetch-Mode": "navigate", Referer: `${ORIGIN}/acme` },
        }),
        context: ctx(),
      } as never,
      { client: "acme", album: "final" },
      e,
    )) as { data: { state: string; backToClient?: unknown } };
    expect(r.data.state).toBe("open");
    expect(r.data.backToClient).toEqual({ name: "ACME Corp", href: "/acme" });
  });
});

import { eq } from "drizzle-orm";
const eqId = (id: string) => eq(schema.clients.id, id);
