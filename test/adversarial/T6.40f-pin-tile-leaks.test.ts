import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { hashPin } from "../../app/lib/server/crypto";
import { loadClientTiles } from "../../app/lib/server/home";
import { loadGallery } from "../../app/lib/server/gallery";
import { migrateDb, resetTables } from "../support/d1";

const db = getDb(env);
const e = env as Env;

async function album(
  slug: string,
  clientId: string | null,
  over: Partial<typeof schema.galleries.$inferInsert> = {},
) {
  await db.insert(schema.galleries).values({
    id: `g-${slug}`,
    driveFolderId: `d-${slug}`,
    slug,
    title: `T ${slug}`,
    status: "published",
    showOnHome: false,
    clientId,
    ...over,
  });
}
beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("photos", "galleries", "clients");
  await db.insert(schema.clients).values([
    { id: "c-a", slug: "acme", name: "A" },
    { id: "c-b", slug: "beta", name: "B" },
  ]);
});

describe("T6.40f PIN tiles", () => {
  it("a locked tile shows no more than the PIN gate shows (the gate hides the event date)", async () => {
    await album("secret", "c-a", {
      pinHash: await hashPin("123456"),
      eventDate: "2026-05-05",
    });
    const gate = await loadGallery(
      new Request("https://x.test/secret", {
        headers: { "Sec-Fetch-Mode": "navigate" },
      }),
      "secret",
      e,
    );
    expect(gate.data).not.toHaveProperty("eventDate");
    const r = await loadClientTiles(e, "acme");
    const tile = r!.tiles.find((t) => t.slug === "secret")!;
    expect(tile.eventDate).toBeNull();
  });
});
