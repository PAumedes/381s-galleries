import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../app/lib/server/drive-types";
import type { MockEntry } from "../app/lib/server/fixtures";
import { runSync } from "../app/lib/server/sync";
import {
  D1_BATCH_MAX,
  D1_IN_CHUNK,
  D1_MAX_BOUND_PARAMS,
  PHOTO_INSERT_ROWS,
} from "../app/lib/server/d1-limits";
import { e, ROOT, db, setup } from "./adversarial/T1.3-helpers";
import { schema } from "../app/db";

setup();

describe("T6.24 D1 limits assumed by sync (Free plan values)", () => {
  it("constants stay within the Free/Paid shared per-statement limits", () => {
    expect(D1_IN_CHUNK).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    expect(D1_BATCH_MAX).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    expect(D1_MAX_BOUND_PARAMS).toBe(100);
  });

  it("no statement binds >100 params and no batch has >100 statements", async () => {
    const T = "2026-01-01T00:00:00.000Z";
    const f = (
      id: string,
      name: string,
      parentId: string | null,
      mime = FOLDER_MIME,
    ): MockEntry => ({
      id,
      name,
      mimeType: mime,
      modifiedTime: T,
      parentId,
      ...(mime === "image/jpeg" ? { width: 2048, height: 1365 } : {}),
    });
    const entries: MockEntry[] = [f(ROOT(), "root", null)];
    // One gallery with enough photos for several insert chunks and >1 batch,
    // plus >90 galleries so the IN (...) lists are chunked on re-sync.
    entries.push(f("big", "Big", ROOT()), f("bigh", "high-res", "big"));
    for (let i = 0; i < 600; i++)
      entries.push(f(`bp${i}`, `IMG_${i}.jpg`, "bigh", "image/jpeg"));
    for (let i = 0; i < 100; i++) {
      entries.push(f(`a${i}`, `Album ${i}`, ROOT()));
      entries.push(f(`h${i}`, "high-res", `a${i}`));
      entries.push(f(`p${i}`, `IMG_${i}.jpg`, `h${i}`, "image/jpeg"));
    }
    const d = createMockDrive({ rootId: ROOT(), entries });
    const maxParams = { n: 0 };
    const maxBatch = { n: 0 };
    const track = (st: object): object =>
      new Proxy(st, {
        get(s, k) {
          const v = (s as never)[k];
          if (k === "bind")
            return (...a: unknown[]) => {
              maxParams.n = Math.max(maxParams.n, a.length);
              return track((v as (...x: unknown[]) => object).apply(s, a));
            };
          return typeof v === "function" ? v.bind(s) : v;
        },
      });
    const wrapped = new Proxy(env.DB, {
      get(t, k) {
        const v = (t as never)[k];
        if (k === "prepare") return (sql: string) => track(t.prepare(sql));
        if (k === "batch")
          return (stmts: unknown[]) => {
            maxBatch.n = Math.max(maxBatch.n, stmts.length);
            return (v as (...x: unknown[]) => unknown).call(t, stmts);
          };
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const ec = { ...e, DB: wrapped } as Env;
    await runSync(ec, { drive: d, budget: 400 });
    await runSync(ec, { drive: d, force: true, budget: 400 });
    expect((await db.select().from(schema.photos)).length).toBe(700);
    // Sanity: the scenario really exercised the chunking.
    expect(maxParams.n).toBeGreaterThan(PHOTO_INSERT_ROWS * 10);
    expect(maxBatch.n).toBeGreaterThan(1);
    expect(maxParams.n).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    expect(maxBatch.n).toBeLessThanOrEqual(D1_BATCH_MAX);
  }, 120_000);
});
