import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema } from "../../app/db";
import { galleryAction } from "../../app/lib/server/admin-galleries";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { runSync } from "../../app/lib/server/sync";
import { db, e, setup } from "./T1.3-helpers";

setup();

const post = (id: string, f: Record<string, string>) =>
  galleryAction(
    new Request(`http://localhost/admin/g/${id}`, {
      method: "POST",
      body: new URLSearchParams(f),
    }),
    e,
    id,
  );

describe("T4.2 sync undoes admin decisions", () => {
  it("a rescan does not reset use_watermark_preview the admin turned off", async () => {
    const drive = createMockDrive();
    await runSync(e, { drive });
    const [wm] = await db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.useWatermarkPreview, true));
    expect(wm).toBeTruthy();
    const r = await post(wm.id, { intent: "flags", allowWeb: "1" });
    expect(r.ok).toBe(true);
    await runSync(e, { drive, force: true });
    const [after] = await db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.id, wm.id));
    expect(after.useWatermarkPreview).toBe(false);
  });

  it("a rescan does not un-archive a gallery the admin archived", async () => {
    const drive = createMockDrive();
    await runSync(e, { drive });
    const [g] = await db.select().from(schema.galleries).limit(1);
    const r = await post(g.id, { intent: "status", to: "archive" });
    expect(r.ok).toBe(true);
    await runSync(e, { drive, force: true });
    const [after] = await db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.id, g.id));
    expect(after.status).toBe("archived");
  });
});
