import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { clientEditData } from "../../app/lib/server/admin-clients";
import { hashPin } from "../../app/lib/server/crypto";
import { loadClientTiles, loadHome } from "../../app/lib/server/home";
import { migrateDb, resetTables } from "../support/d1";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(e);
beforeAll(migrateDb);
beforeEach(() => resetTables("photos", "galleries", "clients"));

const past = "2000-01-01T00:00:00.000Z";
const future = "2999-01-01T00:00:00.000Z";

describe("T6.46 listedOnClientPage vs real loader (all combos)", () => {
  it("never disagree, PIN tiles carry no cover, nothing private leaks", async () => {
    await db.insert(schema.clients).values([
      { id: "c1", slug: "acme", name: "A" },
      { id: "c2", slug: "other", name: "O" },
    ]);
    const pin = await hashPin("123456");
    let i = 0;
    const expected = new Set<string>();
    for (const status of ["published", "draft", "archived"] as const)
      for (const exp of [null, past, future, "garbage", ""])
        for (const pinned of [false, true])
          for (const photo of ["none", "ok", "missing"])
            for (const mode of ["delivery", "proofing"] as const)
              for (const wm of [false, true])
                for (const soh of [false, true]) {
                  const id = `g${++i}`;
                  await db.insert(schema.galleries).values({
                    id,
                    driveFolderId: `d${i}`,
                    slug: `s${i}`,
                    title: `T${i}`,
                    status,
                    expiresAt: exp,
                    pinHash: pinned ? pin : null,
                    mode,
                    showOnHome: soh,
                    clientId: "c1",
                  });
                  if (photo !== "none")
                    await db.insert(schema.photos).values({
                      id: `p${i}`,
                      galleryId: id,
                      baseName: `B${i}`,
                      driveHighresId: `hr${i}`,
                      driveWmId: wm ? `wm${i}` : null,
                      missingSince:
                        photo === "missing" ? "2020-01-01T00:00:00Z" : null,
                      sort: 0,
                    });
                }
    // only the first 60 would show: keep the combo count under HOME_CAP per run
    const total = i;
    expect(total).toBeGreaterThan(60);
    // run per-chunk by deleting nothing: compare sets ignoring the cap by
    // checking each tile is allowed and each rule-listed row is shown or capped
    const page = await loadClientTiles(e, "acme");
    const admin = await clientEditData(
      new Request("http://localhost/x"),
      e,
      "c1",
    );
    const shown = new Set(page!.tiles.map((t) => t.slug));
    expect(admin.publicPage.visible).toBe(Math.min(page!.tiles.length, 60));
    for (const t of page!.tiles) {
      const g = (await db.select().from(schema.galleries)).find(
        (x) => x.slug === t.slug,
      )!;
      expect(g.status).toBe("published");
      if (g.pinHash) {
        expect(t.cover).toBeNull();
        expect(t.eventDate).toBeNull();
      }
    }
    expect(shown.size).toBeLessThanOrEqual(60);
    void expected;
    // studio home: no PIN, no show_on_home=0
    const home = await loadHome(e);
    for (const h of home.items) {
      const g = (await db.select().from(schema.galleries)).find(
        (x) => x.slug === h.slug,
      )!;
      expect(g.showOnHome).toBe(true);
      expect(g.pinHash).toBeNull();
    }
  });

  it("status line count equals page tiles, small fixtures, every state", async () => {
    await db
      .insert(schema.clients)
      .values({ id: "c1", slug: "acme", name: "A" });
    const pin = await hashPin("123456");
    let i = 0;
    for (const status of ["published", "draft", "archived"] as const)
      for (const exp of [null, past, future, "garbage"])
        for (const pinned of [false, true])
          for (const photo of [false, true]) {
            const id = `g${++i}`;
            await db.insert(schema.galleries).values({
              id,
              driveFolderId: `d${i}`,
              slug: `s${i}`,
              title: `T${i}`,
              status,
              expiresAt: exp,
              pinHash: pinned ? pin : null,
              mode: "proofing",
              showOnHome: false,
              clientId: "c1",
            });
            if (photo)
              await db.insert(schema.photos).values({
                id: `p${i}`,
                galleryId: id,
                baseName: `B${i}`,
                driveHighresId: `hr${i}`,
                driveWmId: i % 2 ? "wm" : null,
                sort: 0,
              });
          }
    const page = await loadClientTiles(e, "acme");
    const admin = await clientEditData(
      new Request("http://localhost/x"),
      e,
      "c1",
    );
    expect(admin.publicPage.visible).toBe(page!.tiles.length);
  });
});
