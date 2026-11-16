import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { runSync } from "../../app/lib/server/sync";
const LATER = () => new Date(Date.now() + 2 * 3600_000); // past the delete grace
import { e, galleryBy, photosOf, setup, walk } from "./T1.3-helpers";

setup();

describe("T1.3 R2 cleanup", () => {
  it("removing 40 photos costs O(1) R2 calls, not 2 per photo (each counts as a subrequest)", async () => {
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const g = await galleryBy("retrato-sofia");
    const hr = await walk(d, "Retrato Sofía", "high-res");
    const ps = await photosOf(g.id);
    for (const p of ps) await env.CACHE.put(`${p.id}/thumb`, "x");
    for (const f of (await d.listChildren(hr)).slice(0, 25)) d.removeFile(f.id);
    await runSync(e, { drive: d, force: true }); // first sighting only marks
    let ops = 0;
    const wrap = new Proxy(env.CACHE, {
      get(t, k) {
        const v = (t as never)[k];
        if (k === "list" || k === "delete")
          return (...a: unknown[]) => {
            ops++;
            return (v as (...x: unknown[]) => unknown).apply(t, a);
          };
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const r = await runSync({ ...e, CACHE: wrap } as Env, {
      drive: d,
      force: true,
      now: LATER(),
    });
    expect(r.photos.removed).toBe(25);
    expect(ops).toBeLessThanOrEqual(5);
  });

  it("a failed R2 cleanup is retried later (otherwise orphans are permanent)", async () => {
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const g = await galleryBy("retrato-sofia");
    const hr = await walk(d, "Retrato Sofía", "high-res");
    const victim = (await d.listChildren(hr))[0];
    const row = (await photosOf(g.id)).find(
      (p) => p.driveHighresId === victim.id,
    )!;
    await env.CACHE.put(`${row.id}/thumb`, "x");
    d.removeFile(victim.id);
    await runSync(e, { drive: d, force: true }); // first sighting only marks
    const broken = new Proxy(env.CACHE, {
      get(t, k) {
        if (k === "list" || k === "delete")
          return () => Promise.reject(new Error("r2 down"));
        const v = (t as never)[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    await runSync({ ...e, CACHE: broken } as Env, {
      drive: d,
      force: true,
      now: LATER(),
    });
    await runSync(e, { drive: d, force: true, now: LATER() });
    expect(
      (await env.CACHE.list({ prefix: `${row.id}/` })).objects,
    ).toHaveLength(0);
  });
});
