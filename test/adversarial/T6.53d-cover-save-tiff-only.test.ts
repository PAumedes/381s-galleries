import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { saveCover } from "../../app/lib/server/admin-galleries/actions/cover";
const createT = (_l: string) => (k: string) => k;
import { migrateDb, resetTables } from "../support/d1";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000f4";
beforeAll(migrateDb);

describe("T6.53d adversary: admin cover save", () => {
  it("refuses (or at least does not report success for) a TIFF-only photo with no preview as cover: it is never served", async () => {
    await resetTables("photos", "galleries");
    await db.insert(schema.galleries).values({
      id: G,
      driveFolderId: "f",
      slug: "c",
      title: "C",
      status: "published",
    });
    await db.insert(schema.photos).values([
      {
        id: "T",
        galleryId: G,
        baseName: "T",
        sort: 0,
        driveHighresId: "X",
        driveTiffId: "X",
      },
      {
        id: "J",
        galleryId: G,
        baseName: "J",
        sort: 1,
        driveHighresId: "H",
        driveWebId: "W",
      },
    ]);
    const [g] = await db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.id, G));
    const f = new FormData();
    f.set("photoId", "T");
    const r = await saveCover(env, g, f, createT("es") as never);
    expect(r.ok).toBe(false);
  });
});
