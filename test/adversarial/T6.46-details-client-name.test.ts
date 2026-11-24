import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { galleryAction } from "../../app/lib/server/admin-galleries";
import { migrateDb } from "../support/d1";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
beforeAll(migrateDb);

const act = (id: string, f: Record<string, string>) =>
  galleryAction(
    new Request(`http://localhost/admin/g/${id}`, {
      method: "POST",
      body: new URLSearchParams(f),
    }),
    e,
    id,
  );

describe("T6.46 stale clientName field", () => {
  it("is ignored: no validation error, legacy value untouched", async () => {
    await db.insert(schema.galleries).values({
      id: "gx",
      driveFolderId: "dx",
      slug: "gx",
      title: "T",
      status: "draft",
      clientName: "Legacy",
    });
    const r = await act("gx", {
      intent: "details",
      title: "New",
      slug: "gx",
      eventDate: "",
      expiresDate: "",
      expiresTime: "",
      clientName: "x".repeat(500) + "\u0007",
    });
    expect(r.ok).toBe(true);
    const g = (
      await db
        .select()
        .from(schema.galleries)
        .where(eq(schema.galleries.id, "gx"))
    )[0]!;
    expect(g.clientName).toBe("Legacy");
    expect(JSON.stringify(r)).not.toMatch(/clientName/);
  });
});
