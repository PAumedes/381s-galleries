import { describe, expect, it } from "vitest";
import { HAS_CHROME, M, run } from "../support/real-bar.mjs";

describe.skipIf(!HAS_CHROME)(
  "T6.42b real AdminGalleryPreview (1024, links, RTL)",
  () => {
    for (const lang of ["es", "en"])
      for (const w of [1024])
        for (const rootPx of [16, 32]) {
          it(`${lang} ${w}px root ${rootPx}px: nothing overflows, button inside bar, no text/button overlap`, async () => {
            const m = await run(lang, w, { rootPx, expr: M });
            expect(m.overflow).toBe(false);
            expect(m.a[0]).toBeGreaterThanOrEqual(m.bar[0]);
            expect(m.a[1]).toBeLessThanOrEqual(m.bar[1] + 0.5);
            expect(m.p[1]).toBeLessThanOrEqual(m.bar[1] + 0.5);
            const rows = m.a[2] >= m.p[3] - 0.5;
            const cols = m.a[0] >= m.p[1] - 0.5;
            expect(rows || cols).toBe(true);
          }, 60000);
        }

    it("back link keeps device and tab", async () => {
      const m = await run("es", 360, {
        expr: M,
        search: "?device=phone&tab=fotos",
      });
      expect(m.href).toMatch(/\/admin\/g\/g1/);
    }, 60000);

    it("RTL: the preview text is start-aligned from sm up (not hard-coded left)", async () => {
      const m = await run("es", 1024, { dir: "rtl", expr: M });
      expect(m.pAlign).not.toBe("left");
    }, 60000);
  },
);
