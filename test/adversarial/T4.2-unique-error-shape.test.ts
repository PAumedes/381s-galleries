import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema } from "../../app/db";
import { db, setup } from "./T1.3-helpers";

setup();

describe("T4.2 slug race: saveDetails matches /UNIQUE/ on err.message", () => {
  // Documents the finding (drizzle wraps the driver error); fixed by walking err.cause.
  it.skip("drizzle's error for a unique violation matches /UNIQUE/", async () => {
    await db.insert(schema.galleries).values([
      { id: "a2", driveFolderId: "fa2", slug: "one", title: "T" },
      { id: "b2", driveFolderId: "fb2", slug: "two", title: "T" },
    ]);
    const err = await db
      .update(schema.galleries)
      .set({ slug: "ONE" })
      .where(eq(schema.galleries.id, "b2"))
      .then(
        () => null,
        (x: unknown) => x,
      );
    expect(String((err as Error).message)).toMatch(/UNIQUE/i);
  });
});
