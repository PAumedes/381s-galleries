import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { runSync } from "../../app/lib/server/sync";
import { e, galleryBy, photosOf, setup, walk } from "./T1.3-helpers";

setup();

describe("T1.3r2 R2 keys of rows already hard-deleted must survive a failed run", () => {
  it("run fails after the DB delete committed (token write fails): next run still cleans the R2 keys", async () => {
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
    await runSync(e, { drive: d, force: true }); // mark
    const later = new Date(Date.now() + 2 * 3600_000);
    const failing = new Proxy(env.DB, {
      get(t, k) {
        if (k === "prepare")
          return (sql: string) => {
            const st = t.prepare(sql);
            return new Proxy(st, {
              get(s, kk) {
                if (kk === "bind")
                  return (...a: unknown[]) => {
                    const b = s.bind(...a);
                    if (
                      /insert into "settings"/i.test(sql) &&
                      a.includes("drive_changes_token")
                    )
                      return new Proxy(b, {
                        get(bb, k3) {
                          if (
                            ["run", "all", "raw", "first"].includes(String(k3))
                          )
                            return () => Promise.reject(new Error("d1 down"));
                          const v = (bb as never)[k3];
                          return typeof v === "function" ? v.bind(bb) : v;
                        },
                      });
                    return b;
                  };
                const v = (s as never)[kk];
                return typeof v === "function" ? v.bind(s) : v;
              },
            });
          };
        const v = (t as never)[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    await expect(
      runSync({ ...e, DB: failing } as Env, {
        drive: d,
        force: true,
        now: later,
      }),
    ).rejects.toThrow();
    expect((await photosOf(g.id)).some((p) => p.id === row.id)).toBe(false); // precondition: row gone
    await runSync(e, { drive: d, force: true, now: later });
    expect(
      (await env.CACHE.list({ prefix: `${row.id}/` })).objects,
    ).toHaveLength(0);
  });
});
