import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "../../app/db";
import { FOLDER_MIME } from "../../app/lib/server/drive-types";
import type { MockEntry } from "../../app/lib/server/fixtures";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { runSync } from "../../app/lib/server/sync";
import { db, e, setup, galleryBy } from "./T1.3-helpers";

setup();
const T = "2026-01-01T00:00:00.000Z";
const dir = (id: string, name: string, parentId: string): MockEntry => ({
  id,
  name,
  mimeType: FOLDER_MIME,
  modifiedTime: T,
  parentId,
});
const img = (id: string, name: string, parentId: string): MockEntry =>
  ({
    id,
    name,
    mimeType: "image/jpeg",
    modifiedTime: T,
    parentId,
  }) as MockEntry;

describe("T6.3 sync must never change mode of an existing gallery", () => {
  it("delivery gallery stays delivery when preview-wm appears later", async () => {
    const entries: MockEntry[] = [
      dir("root", "root", null as unknown as string),
      dir("alb", "Boda", "root"),
      dir("hr", "high-res", "alb"),
      img("a", "a.jpg", "hr"),
    ];
    const d = createMockDrive({ rootId: "root", entries });
    await db
      .update(schema.settings)
      .set({ value: "root" })
      .where(eq(schema.settings.key, "drive_root_id"));
    await runSync(e, { drive: d });
    const g = await galleryBy("boda");
    expect(g.mode).toBe("delivery");
    d.addFile("alb", { name: "preview-wm", mimeType: FOLDER_MIME });
    const wm = (await d.listChildren("alb")).find(
      (x) => x.name === "preview-wm",
    )!;
    d.addFile(wm.id, { name: "a.jpg", width: 800, height: 600 });
    await runSync(e, {
      drive: d,
      force: true,
      now: new Date(Date.now() + 2 * 3600_000),
    });
    expect((await galleryBy("boda")).mode).toBe("delivery");
  });
});
