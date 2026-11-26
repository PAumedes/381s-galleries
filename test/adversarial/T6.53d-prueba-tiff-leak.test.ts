import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { buildOpenData } from "../../app/lib/server/gallery-open-data";
import { migrateDb, resetTables } from "../support/d1";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000f3";
beforeAll(migrateDb);

describe("T6.53d adversary: Prueba never advertises the original", () => {
  it("a Prueba photo that has a preview-wm AND a TIFF exposes no TIFF name/size (Prueba = no originals)", async () => {
    await resetTables("photos", "galleries");
    await db.insert(schema.galleries).values({
      id: G,
      driveFolderId: "f",
      slug: "p",
      title: "P",
      status: "published",
      mode: "proofing",
    });
    await db.insert(schema.photos).values({
      id: "A",
      galleryId: G,
      baseName: "SECRET_ORIGINAL_NAME",
      sort: 0,
      driveHighresId: "H",
      driveTiffId: "T",
      driveWmId: "WM",
      highresBytes: 312_000_000,
      width: 3000,
      height: 2000,
      variantVersions: JSON.stringify({ highres: "h", wm: "w", tiff: "t" }),
    });
    const [g] = await db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.id, G));
    const d = await buildOpenData(env, g);
    expect(JSON.stringify(d.photos[0])).not.toMatch(
      /SECRET_ORIGINAL_NAME|312000000/,
    );
  });
});
