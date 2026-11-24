import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { listGalleries } from "../../app/lib/server/admin-galleries";
import { migrateDb, resetTables } from "../support/d1";

const db = getDb(env);
beforeAll(migrateDb);
beforeEach(() => resetTables("photos", "galleries", "clients"));

describe("T6.46 admin list search follows what the row shows", () => {
  it("finds an album by its client folder name", async () => {
    await db
      .insert(schema.clients)
      .values({ id: "c", slug: "acme", name: "Acme Corp" });
    await db.insert(schema.galleries).values({
      id: "g",
      driveFolderId: "d",
      slug: "boda",
      title: "Boda",
      status: "draft",
      clientId: "c",
    });
    const r = await listGalleries(env as Env, "all" as never, "acme corp");
    expect(r.map((x) => x.slug)).toEqual(["boda"]);
  });

  it("does not match hidden legacy text when a folder is assigned (row shows the folder)", async () => {
    await db
      .insert(schema.clients)
      .values({ id: "c", slug: "acme", name: "Acme Corp" });
    await db.insert(schema.galleries).values({
      id: "g",
      driveFolderId: "d",
      slug: "boda",
      title: "Boda",
      status: "draft",
      clientId: "c",
      clientName: "OldSecretName",
    });
    const r = await listGalleries(env as Env, "all" as never, "oldsecretname");
    expect(r).toEqual([]);
  });
});
