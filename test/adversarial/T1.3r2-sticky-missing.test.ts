import { describe, expect, it } from "vitest";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { runSync } from "../../app/lib/server/sync";
import { e, galleryBy, photosOf, setup, walk } from "./T1.3-helpers";

setup();
const H = 3600_000;

describe("T1.3r2 grace period must not pin the library into perpetual rescans", () => {
  it("photos marked missing, then high-res emptied (highres_empty): later runs must settle to 'unchanged'", async () => {
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const hr = await walk(d, "Retrato Sofía", "high-res");
    const files = await d.listChildren(hr);
    d.removeFile(files[0].id);
    await runSync(e, { drive: d, force: true }); // marks one
    for (const f of files.slice(1)) d.removeFile(f.id);
    const t = new Date(Date.now() + 2 * H);
    await runSync(e, { drive: d, now: t });
    const r = await runSync(e, {
      drive: d,
      now: new Date(t.getTime() + 15 * 60_000),
    });
    expect(r.skipped).toBe("unchanged");
  });

  it("photo marked missing, then whole album folder disappears: after archiving, runs must settle to 'unchanged'", async () => {
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const hr = await walk(d, "Retrato Sofía", "high-res");
    d.removeFile((await d.listChildren(hr))[0].id);
    await runSync(e, { drive: d, force: true }); // marks one photo
    d.trashFile(await walk(d, "Retrato Sofía"));
    const t0 = Date.now();
    await runSync(e, { drive: d, now: new Date(t0 + 2 * H) });
    await runSync(e, { drive: d, now: new Date(t0 + 4 * H) });
    expect((await galleryBy("retrato-sofia")).status).toBe("archived");
    const r = await runSync(e, {
      drive: d,
      now: new Date(t0 + 4 * H + 900_000),
    });
    expect(r.skipped).toBe("unchanged");
    expect(
      (await photosOf((await galleryBy("retrato-sofia")).id)).some(
        (p) => p.missingSince,
      ),
    ).toBe(true);
  });
});
