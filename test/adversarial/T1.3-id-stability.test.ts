import { describe, expect, it } from "vitest";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { runSync } from "../../app/lib/server/sync";
import { e, galleryBy, photosOf, setup, walk } from "./T1.3-helpers";

setup();

describe("T1.3 photo id stability", () => {
  it("re-export (new Drive file id, same name) keeps photo ids", async () => {
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const g = await galleryBy("retrato-sofia");
    const before = await photosOf(g.id);
    const hr = await walk(d, "Retrato Sofía", "high-res");
    for (const f of await d.listChildren(hr)) {
      d.removeFile(f.id);
      d.addFile(hr, { name: f.name, width: f.width, height: f.height });
    }
    await runSync(e, { drive: d, force: true });
    const after = await photosOf(g.id);
    expect(new Set(after.map((p) => p.id))).toEqual(
      new Set(before.map((p) => p.id)),
    );
  });

  it("case-only rename of a set folder keeps photo ids (base names are case-insensitive)", async () => {
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const g = await galleryBy("2026-11-14-boda-ana-y-juan");
    const before = await photosOf(g.id);
    if (!g) throw new Error("fixture slug differs");
    for (const r of ["high-res", "web", "ig", "thumb"]) {
      const id = await walk(
        d,
        "2026-11-14 Boda Ana y Juan",
        r,
        "Ceremonia",
      ).catch(() => null);
      if (id) d.renameFile(id, "ceremonia");
    }
    await runSync(e, { drive: d, force: true });
    const after = await photosOf(g.id);
    expect(new Set(after.map((p) => p.id))).toEqual(
      new Set(before.map((p) => p.id)),
    );
  });
});
