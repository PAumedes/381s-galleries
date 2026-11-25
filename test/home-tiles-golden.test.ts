import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { hashPin } from "../app/lib/server/crypto";
import { loadClientTiles, loadHome } from "../app/lib/server/home";
import { migrateDb, resetTables } from "./support/d1";

const e = { ...env, DRIVE_MODE: "mock" } as Env;
const db = getDb(e);
beforeAll(migrateDb);
beforeEach(() => resetTables("photos", "galleries", "clients"));

const past = "2000-01-01T00:00:00.000Z";
const future = "2999-01-01T00:00:00.000Z";

type G = Partial<typeof schema.galleries.$inferInsert> & { id: string };
async function gallery(
  g: G,
  photo?: Partial<typeof schema.photos.$inferInsert>,
) {
  await db.insert(schema.galleries).values({
    driveFolderId: `d-${g.id}`,
    slug: g.id,
    title: `T ${g.id}`,
    status: "published",
    showOnHome: true,
    ...g,
  });
  if (photo)
    await db.insert(schema.photos).values({
      id: `p-${g.id}`,
      galleryId: g.id,
      baseName: `B-${g.id}`,
      driveHighresId: `hr-${g.id}`,
      sort: 0,
      ...photo,
    });
}

describe("T6.48 home / client tiles (golden, pre-refactor)", () => {
  it("home and client page over a mixed fixture", async () => {
    await db.insert(schema.clients).values([
      { id: "c1", slug: "acme", name: "Acme" },
      { id: "c2", slug: "off", name: "Off", pageEnabled: false },
    ]);
    const pin = await hashPin("123456");
    await gallery(
      {
        id: "a1",
        eventDate: "2026-05-01",
        clientId: "c1",
        coverFocusX: 30,
        coverFocusY: 60,
      },
      {
        width: 3000,
        height: 2000,
        variantVersions: JSON.stringify({
          highres: "v1",
          thumb: "v2",
          wm: "v3",
        }),
        driveThumbId: "th",
        driveWmId: "wm",
      },
    );
    await gallery(
      { id: "a2", eventDate: "2026-06-01", clientId: "c1", mode: "proofing" },
      { driveWmId: "wm2", width: 2000, height: 3000 },
    );
    await gallery(
      { id: "a3", eventDate: "2026-07-01", clientId: "c1", mode: "proofing" },
      { driveWmId: null },
    );
    await gallery(
      { id: "a4", eventDate: "2026-08-01", clientId: "c1", pinHash: pin },
      { width: 10, height: 10 },
    );
    await gallery(
      { id: "a5", clientId: "c1", expiresAt: past },
      { width: 1, height: 1 },
    );
    await gallery(
      { id: "a6", clientId: "c1", expiresAt: future, showOnHome: false },
      {},
    );
    await gallery({ id: "a7", clientId: "c1", status: "draft" }, {});
    await gallery({ id: "a8", clientId: "c1" });
    await gallery(
      { id: "a9", clientId: "c1" },
      { missingSince: "2020-01-01T00:00:00Z" },
    );
    await gallery({ id: "b1", clientId: "c2" }, {});
    await gallery(
      { id: "n1", eventDate: "2026-04-01" },
      { width: 400, height: 300 },
    );
    await gallery({ id: "n2", eventDate: null }, {});
    expect(await loadHome(e)).toMatchSnapshot("home");
    expect(await loadClientTiles(e, "acme")).toMatchSnapshot("acme");
    expect(await loadClientTiles(e, "ACME")).toMatchSnapshot("acme upper");
    expect(await loadClientTiles(e, "off")).toBeNull();
    expect(await loadClientTiles(e, "nope")).toBeNull();
  });
  it("caps at 60 and lists nothing for an empty home", async () => {
    expect(await loadHome(e)).toEqual({ items: [] });
    for (let i = 0; i < 63; i++)
      await gallery(
        {
          id: `m${String(i).padStart(2, "0")}`,
          eventDate: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {},
      );
    const { items } = await loadHome(e);
    expect(items).toHaveLength(60);
    expect(items.map((i) => i.slug)).toMatchSnapshot("cap order");
  });
});
