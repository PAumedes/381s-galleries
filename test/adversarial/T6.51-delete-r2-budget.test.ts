// T6.51 guard: deleteLocked's R2 call budget and pending-delete bookkeeping.
// These pass on the current code; they exist because mutating the new helpers
// (drainPendingR2 returning `calls` instead of `calls - take.length`, or
// slicing the saved remainder one chunk too far) left every existing test green.
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteGallery } from "../../app/lib/server/gallery-delete";
import { migrateDb, resetTables } from "../support/d1";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const G = "aaaaaaaa-0000-4000-8000-0000000000aa";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables("photos", "galleries", "settings", "ignored_folders");
});

async function seedGallery(photos: number) {
  await env.DB.prepare(
    "INSERT INTO galleries (id, drive_folder_id, slug, title, status) VALUES (?1,'f-x','s-x','T','published')",
  )
    .bind(G)
    .run();
  const stmts = [];
  for (let i = 0; i < photos; i++)
    stmts.push(
      env.DB.prepare(
        "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES (?1, ?2, ?3, 'h')",
      ).bind(`p-${i}`, G, `N${i}`),
    );
  for (let i = 0; i < stmts.length; i += 50)
    await env.DB.batch(stmts.slice(i, i + 50));
}

function counting() {
  const calls: number[] = [];
  const wrapped = new Proxy(env.CACHE, {
    get(t, k) {
      if (k === "delete")
        return async (keys: string | string[]) => {
          calls.push(Array.isArray(keys) ? keys.length : 1);
          return t.delete(keys as string[]);
        };
      const v = (t as never)[k];
      return typeof v === "function" ? (v as () => unknown).bind(t) : v;
    },
  });
  return { calls, env: { ...e, CACHE: wrapped } as Env };
}

describe("T6.51 deleteLocked R2 budget", () => {
  it("pending flush and photo purge share ONE r2CallsMax budget", async () => {
    await seedGallery(700); // 3 R2 calls of 333 photos
    const pend = Array.from({ length: 700 }, (_, i) => `old-${i}`); // 3 calls
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('r2_pending_deletes', ?1)",
    )
      .bind(JSON.stringify(pend))
      .run();
    const c = counting();
    expect(await deleteGallery(c.env, G, { r2CallsMax: 4 })).toBe("continue");
    expect(c.calls.length).toBeLessThanOrEqual(4);
  });

  it("an exhausted budget keeps exactly the unflushed pending ids", async () => {
    await seedGallery(1);
    const pend = Array.from({ length: 700 }, (_, i) => `old-${i}`);
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('r2_pending_deletes', ?1)",
    )
      .bind(JSON.stringify(pend))
      .run();
    const c = counting();
    expect(await deleteGallery(c.env, G, { r2CallsMax: 1 })).toBe("continue");
    const left = JSON.parse(
      (await env.DB.prepare(
        "SELECT value FROM settings WHERE key='r2_pending_deletes'",
      ).first<{ value: string }>())!.value,
    ) as string[];
    expect(left).toEqual(pend.slice(333));
  });
});
