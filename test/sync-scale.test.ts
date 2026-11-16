import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../app/lib/server/drive-types";
import type { MockEntry } from "../app/lib/server/fixtures";
import { runSync } from "../app/lib/server/sync";
import { e, ROOT, db, setup } from "./adversarial/T1.3-helpers";
import { schema } from "../app/db";

setup();

describe("sync CF-op scaling", () => {
  it("400 galleries sync and re-sync (forced) under the 900 CF-op cap", async () => {
    const T = "2026-01-01T00:00:00.000Z";
    const f = (
      id: string,
      name: string,
      parentId: string,
      mime = FOLDER_MIME,
    ): MockEntry => ({
      id,
      name,
      mimeType: mime,
      modifiedTime: T,
      parentId,
      ...(mime === "image/jpeg" ? { width: 2048, height: 1365 } : {}),
    });
    const entries: MockEntry[] = [f(ROOT(), "root", null as never)];
    entries[0].parentId = null;
    for (let i = 0; i < 400; i++) {
      entries.push(f(`a${i}`, `Album ${i}`, ROOT()));
      entries.push(f(`h${i}`, "high-res", `a${i}`));
      entries.push(f(`p${i}`, `IMG_${i}.jpg`, `h${i}`, "image/jpeg"));
    }
    const d = createMockDrive({ rootId: ROOT(), entries });
    const spy = { n: 0 };
    // Counts D1 round trips: one per batch() and one per direct statement run.
    const countStmt = (st: object): object =>
      new Proxy(st, {
        get(s, k) {
          const v = (s as never)[k];
          if (k === "bind")
            return (...a: unknown[]) =>
              countStmt((v as (...x: unknown[]) => object).apply(s, a));
          if (["run", "all", "first", "raw"].includes(String(k)))
            return (...a: unknown[]) => {
              spy.n++;
              return (v as (...x: unknown[]) => unknown).apply(s, a);
            };
          return typeof v === "function" ? v.bind(s) : v;
        },
      });
    const counting = new Proxy(env.DB, {
      get(t, k) {
        const v = (t as never)[k];
        if (k === "prepare") return (sql: string) => countStmt(t.prepare(sql));
        if (k === "batch")
          return (...a: unknown[]) => {
            spy.n++;
            return (v as (...x: unknown[]) => unknown).apply(t, a);
          };
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const ec = { ...e, DB: counting } as Env;
    await runSync(ec, { drive: d, budget: 200 });
    expect(spy.n).toBeLessThan(900);
    expect((await db.select().from(schema.photos)).length).toBe(400);
    spy.n = 0;
    const r = await runSync(ec, { drive: d, force: true, budget: 200 });
    expect(r.photos).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(spy.n).toBeLessThan(100);
  }, 120_000);
});
