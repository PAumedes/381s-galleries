import { describe, expect, it } from "vitest";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { runSync } from "../../app/lib/server/sync";
import { e, galleryBy, photosOf, setup, walk } from "./T1.3-helpers";

setup();

describe("T1.3 data loss on transient states", () => {
  it("high-res folder momentarily empty (C1 re-export clears it) must not delete photos on the first scan", async () => {
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const g = await galleryBy("retrato-sofia");
    const before = await photosOf(g.id);
    expect(before.length).toBe(30);
    const hr = await walk(d, "Retrato Sofía", "high-res");
    for (const f of await d.listChildren(hr)) d.removeFile(f.id);
    await runSync(e, { drive: d, force: true });
    // ids (favorites/downloads reference them, FK cascade) are gone after one bad scan
    expect((await photosOf(g.id)).length).toBe(30);
  });

  it("renaming the high-res folder momentarily wipes every photo of the gallery", async () => {
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const g = await galleryBy("retrato-sofia");
    const hr = await walk(d, "Retrato Sofía", "high-res");
    d.renameFile(hr, "high-res-old");
    await runSync(e, { drive: d, force: true });
    expect((await photosOf(g.id)).length).toBe(30);
  });
});
