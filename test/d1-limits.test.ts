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

const T = "2026-01-01T00:00:00.000Z";
const later = () => new Date(Date.now() + 2 * 3600_000); // past the sync grace
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

/** One big gallery (`bigPhotos` photos) plus `albums` one-photo galleries. */
function library(bigPhotos: number, albums: number): MockEntry[] {
  const entries: MockEntry[] = [f(ROOT(), "root", null)];
  entries.push(f("big", "Big", ROOT()), f("bigh", "high-res", "big"));
  for (let i = 0; i < bigPhotos; i++)
    entries.push(f(`bp${i}`, `IMG_${i}.jpg`, "bigh", "image/jpeg"));
  for (let i = 0; i < albums; i++) {
    entries.push(f(`a${i}`, `Album ${i}`, ROOT()));
    entries.push(f(`h${i}`, "high-res", `a${i}`));
    entries.push(f(`p${i}`, `IMG_${i}.jpg`, `h${i}`, "image/jpeg"));
  }
  return entries;
}

/** Env whose DB records the max bound params per statement and max batch size. */
function trackedEnv() {
  const max = { params: 0, batch: 0 };
  const track = (st: object): object =>
    new Proxy(st, {
      get(s, k) {
        const v = (s as never)[k];
        if (k === "bind")
          return (...a: unknown[]) => {
            max.params = Math.max(max.params, a.length);
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
          max.batch = Math.max(max.batch, stmts.length);
          return (v as (...x: unknown[]) => unknown).call(t, stmts);
        };
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  return { max, ec: { ...e, DB: wrapped } as Env };
}

describe("T6.24 D1 limits assumed by sync (Free plan values)", () => {
  it("constants stay within the Free/Paid shared per-statement limits", () => {
    expect(D1_IN_CHUNK).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    expect(D1_BATCH_MAX).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    expect(D1_MAX_BOUND_PARAMS).toBe(100);
  });

  it("no statement binds >100 params and no batch has >100 statements", async () => {
    // >90 galleries so the IN (...) lists are chunked on re-sync.
    const d = createMockDrive({ rootId: ROOT(), entries: library(600, 100) });
    const { max, ec } = trackedEnv();
    await runSync(ec, { drive: d, budget: 400 });
    await runSync(ec, { drive: d, force: true, budget: 400 });
    expect((await db.select().from(schema.photos)).length).toBe(700);
    // Sanity: the scenario really exercised the chunking.
    expect(max.params).toBeGreaterThan(PHOTO_INSERT_ROWS * 10);
    expect(max.batch).toBeGreaterThan(1);
    expect(max.params).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    expect(max.batch).toBeLessThanOrEqual(D1_BATCH_MAX);
  }, 120_000);

  it("removal paths (goneIds, toMark, firstSeen, archive) are chunked too", async () => {
    const { max, ec } = trackedEnv();
    await runSync(ec, {
      drive: createMockDrive({ rootId: ROOT(), entries: library(600, 130) }),
      budget: 400,
    });
    // 150 photos and 120 albums vanish from Drive.
    const gone = new Set<string>();
    for (let i = 0; i < 150; i++) gone.add(`bp${i}`);
    for (let i = 0; i < 120; i++)
      for (const k of ["a", "h", "p"]) gone.add(`${k}${i}`);
    const shrunk = createMockDrive({
      rootId: ROOT(),
      entries: library(600, 130).filter((x) => !gone.has(x.id)),
    });
    max.params = 0;
    // First pass marks (toMark / folderMissingSince), second, past the grace,
    // deletes photos (goneIds) and archives the albums.
    await runSync(ec, { drive: shrunk, force: true, budget: 400 });
    expect(
      (await db.select().from(schema.photos)).filter((p) => p.missingSince)
        .length,
    ).toBeGreaterThan(D1_IN_CHUNK);
    await runSync(ec, {
      drive: shrunk,
      force: true,
      now: later(),
      budget: 400,
    });
    expect((await db.select().from(schema.photos)).length).toBeLessThan(600);
    const galleries = await db.select().from(schema.galleries);
    expect(
      galleries.filter((g) => g.status === "archived").length,
    ).toBeGreaterThan(D1_IN_CHUNK);
    expect(max.params).toBeGreaterThan(D1_IN_CHUNK - 1);
    expect(max.params).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    expect(max.batch).toBeLessThanOrEqual(D1_BATCH_MAX);
  }, 120_000);
});
