import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../app/db";
import { createMockDrive } from "../app/lib/server/drive-mock";
import type { MockDrive } from "../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../app/lib/server/drive-types";
import type { MockEntry } from "../app/lib/server/fixtures";
import { runSync } from "../app/lib/server/sync";

/**
 * T-refactor-runSync characterization: pins the observable behaviour of every
 * phase of runSync (lock, pending flush, change detection, scan, reconcile,
 * gallery diff, photo diff, absent-folder archive, token, unlock) so the
 * decomposition can be proven behaviour-preserving.
 */
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const NOW = new Date("2026-03-01T12:00:00Z");
const LATER = new Date("2026-03-01T14:00:00Z"); // past the 1h grace
const T = "2026-01-01T00:00:00.000Z";
const ROOT = "root";
const ALPHA = "2026-02-10-alpha";

const folder = (id: string, name: string, parentId: string): MockEntry => ({
  id,
  name,
  mimeType: FOLDER_MIME,
  modifiedTime: T,
  parentId,
});
const jpg = (id: string, name: string, parentId: string): MockEntry => ({
  id,
  name,
  mimeType: "image/jpeg",
  modifiedTime: T,
  parentId,
  width: 2000,
  height: 1000,
});

/** Album `Alpha` (proofing: has preview-wm, two sets) and `Beta` (delivery). */
function entries(): MockEntry[] {
  return [
    { ...folder(ROOT, "root", ""), parentId: null },
    folder("alpha", "2026-02-10 Alpha", ROOT),
    folder("a-hr", "high-res", "alpha"),
    jpg("a1", "A1.jpg", "a-hr"),
    jpg("a2", "A2.jpg", "a-hr"),
    folder("a-set", "Ceremonia", "a-hr"),
    jpg("a3", "A3.jpg", "a-set"),
    folder("a-wm", "preview-wm", "alpha"),
    jpg("a1w", "A1.jpg", "a-wm"),
    folder("a-tw", "thumb-wm", "alpha"),
    jpg("a1t", "A1.jpg", "a-tw"),
    folder("beta", "Beta", ROOT),
    folder("b-hr", "high-res", "beta"),
    jpg("b1", "B1.jpg", "b-hr"),
    folder("b-web", "web", "beta"),
    jpg("b1w", "B1.jpg", "b-web"),
  ];
}
const newDrive = (): MockDrive =>
  createMockDrive({ rootId: ROOT, entries: entries() });

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  // Row order in D1 follows the random primary key: pin ids so runs are reproducible.
  let n = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(
    () =>
      `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
  );
  await db.delete(schema.galleries);
  await db.delete(schema.ignoredFolders);
  await db.delete(schema.settings);
  for (const o of (await env.CACHE.list()).objects)
    await env.CACHE.delete(o.key);
  await db
    .insert(schema.settings)
    .values({ key: "drive_root_id", value: ROOT });
});

const gal = async (slug: string) =>
  (
    await db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.slug, slug))
  )[0];
const photos = (gid: string) =>
  db.select().from(schema.photos).where(eq(schema.photos.galleryId, gid));
const setting = async (key: string) =>
  (
    await db.select().from(schema.settings).where(eq(schema.settings.key, key))
  )[0]?.value;
const names = async (slug: string) =>
  (await photos((await gal(slug)).id))
    .map((p) => `${p.setName}/${p.baseName}${p.missingSince ? "?" : ""}`)
    .sort();

/** DB proxy that records every statement (text + params) and batch boundary. */
function recordingEnv(failBatchAt?: number) {
  const log: string[] = [];
  let batches = 0;
  const info = new WeakMap<object, string>();
  const track = (st: object, text: string): object => {
    const p: object = new Proxy(st, {
      get(s, k) {
        const v = (s as never)[k];
        if (k === "bind")
          return (...a: unknown[]) => {
            const b = (v as (...x: unknown[]) => object).apply(s, a);
            const t = `${text} <- ${JSON.stringify(a)}`;
            const q = track(b, t);
            info.set(q, t);
            return q;
          };
        if (["run", "all", "first", "raw"].includes(k as string))
          return (...a: unknown[]) => {
            log.push(`EXEC ${info.get(p) ?? text}`);
            return (v as (...x: unknown[]) => unknown).apply(s, a);
          };
        return typeof v === "function" ? v.bind(s) : v;
      },
    });
    return p;
  };
  const wrapped = new Proxy(env.DB, {
    get(t, k) {
      const v = (t as never)[k];
      if (k === "prepare") return (sql: string) => track(t.prepare(sql), sql);
      if (k === "batch")
        return (stmts: object[]) => {
          batches++;
          log.push(
            `BATCH ${stmts.length}`,
            ...stmts.map((s) => `  ${info.get(s) ?? "?"}`),
          );
          if (batches === failBatchAt) throw new Error("boom");
          return (v as (...x: unknown[]) => unknown).call(t, stmts);
        };
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  /** Log with random uuids replaced by stable placeholders (by first appearance). */
  const normalized = () => {
    const seen = new Map<string, string>();
    return log
      .map((l) =>
        l.replace(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
          (u) => {
            if (!seen.has(u)) seen.set(u, `<uuid${seen.size + 1}>`);
            return seen.get(u)!;
          },
        ),
      )
      .join("\n");
  };
  return { ec: { ...e, DB: wrapped } as Env, normalized, log };
}

describe("T-refactor-runSync: new gallery discovery", () => {
  it("creates galleries/photos, proofing from preview-wm, delivery otherwise, sets and sort", async () => {
    const r = await runSync(e, { drive: newDrive(), now: NOW });
    expect(r).toMatchObject({
      galleries: { created: 2, updated: 0, archived: 0 },
      photos: { added: 4, updated: 0, removed: 0 },
      issues: 7,
    });
    expect(r.skipped).toBeUndefined();
    const a = await gal(ALPHA);
    expect([a.title, a.eventDate, a.mode, a.status]).toEqual([
      "Alpha",
      "2026-02-10",
      "proofing",
      "published",
    ]);
    expect(a.lastSyncedAt).toBe("2026-03-01T12:00:00Z");
    expect(a.folderMissingSince).toBeNull();
    expect(await names(ALPHA)).toEqual([
      "Ceremonia/A3",
      "Highlights/A1",
      "Highlights/A2",
    ]);
    expect((await gal("beta")).mode).toBe("delivery");
    const ps = await photos(a.id);
    expect(ps.map((p) => p.sort).sort()).toEqual([0, 1, 2]);
    expect(ps.find((p) => p.baseName === "A1")?.driveThumbWmId).toBe("a1t");
    expect(await setting("drive_changes_token")).toBeTruthy();
    expect(await setting("sync_lock")).toBeUndefined();
  });

  it("an existing gallery keeps its admin-owned fields; unchanged re-run writes nothing", async () => {
    const d = newDrive();
    await runSync(e, { drive: d, now: NOW });
    await db
      .update(schema.galleries)
      .set({ mode: "delivery", title: "Mine" })
      .where(eq(schema.galleries.slug, ALPHA));
    const r = await runSync(e, { drive: d, force: true, now: NOW });
    expect(r.galleries).toEqual({ created: 0, updated: 0, archived: 0 });
    expect(r.photos).toEqual({ added: 0, updated: 0, removed: 0 });
    const a = await gal(ALPHA);
    expect([a.mode, a.title]).toEqual(["delivery", "Mine"]);
  });
});

describe("T-refactor-runSync: photo add / rename / move / remove", () => {
  it("rename = add + mark; move between sets likewise; delete only after grace", async () => {
    const d = newDrive();
    await runSync(e, { drive: d, now: NOW });
    d.renameFile("a1", "A1x.jpg"); // rename
    d.addFile("a-hr", { ...jpg("n", "NEW.jpg", "a-hr") });
    const r2 = await runSync(e, { drive: d, force: true, now: NOW });
    expect(r2.photos).toEqual({ added: 2, updated: 0, removed: 0 });
    expect(await names(ALPHA)).toEqual([
      "Ceremonia/A3",
      "Highlights/A1?",
      "Highlights/A1x",
      "Highlights/A2",
      "Highlights/NEW",
    ]);
    const r3 = await runSync(e, { drive: d, force: true, now: LATER });
    expect(r3.photos.removed).toBe(1);
    expect(await names(ALPHA)).not.toContain("Highlights/A1?");
    expect(await names(ALPHA)).toHaveLength(4);
    const pend = JSON.parse((await setting("r2_pending_deletes")) ?? "[]");
    expect(pend).toEqual([]); // flushed at the end of the run
  });

  it("within grace a mark is kept (not deleted, not re-stamped); a returning photo is cleared", async () => {
    const d = newDrive();
    await runSync(e, { drive: d, now: NOW });
    d.trashFile("a2");
    await runSync(e, { drive: d, force: true, now: NOW });
    const before = (await photos((await gal(ALPHA)).id)).find(
      (p) => p.baseName === "A2",
    )!;
    expect(before.missingSince).toBe("2026-03-01T12:00:00Z");
    const mid = new Date("2026-03-01T12:30:00Z");
    const r = await runSync(e, { drive: d, force: true, now: mid });
    expect(r.photos.removed).toBe(0);
    const still = (await photos((await gal(ALPHA)).id)).find(
      (p) => p.baseName === "A2",
    )!;
    expect(still.missingSince).toBe("2026-03-01T12:00:00Z");
  });

  it("variant change counts as updated and keeps the row id", async () => {
    const d = newDrive();
    await runSync(e, { drive: d, now: NOW });
    const id = (await photos((await gal("beta")).id))[0].id;
    d.addFile("b-web", jpg("b1w2", "B1.jpg", "b-web"));
    d.removeFile("b1w");
    const r = await runSync(e, { drive: d, force: true, now: NOW });
    expect(r.photos.updated).toBe(1);
    const p = (await photos((await gal("beta")).id))[0];
    expect([p.id, p.driveWebId]).toEqual([id, "b1w2"]);
  });
});

describe("T-refactor-runSync: absent folders, archive, ignored folders", () => {
  it("folder gone: mark, archive after grace remembering prev status, rows kept, show_on_home off", async () => {
    const d = newDrive();
    await runSync(e, { drive: d, now: NOW });
    await db
      .update(schema.galleries)
      .set({ showOnHome: true })
      .where(eq(schema.galleries.slug, "beta"));
    d.removeFile("beta");
    const r1 = await runSync(e, { drive: d, force: true, now: NOW });
    expect(r1.galleries.archived).toBe(0);
    let b = await gal("beta");
    expect([b.status, b.folderMissingSince]).toEqual([
      "published",
      "2026-03-01T12:00:00Z",
    ]);
    const r2 = await runSync(e, { drive: d, force: true, now: LATER });
    expect(r2.galleries.archived).toBe(1);
    b = await gal("beta");
    expect([
      b.status,
      b.archivedPrevStatus,
      b.archivedBySync,
      b.showOnHome,
      b.folderMissingSince,
    ]).toEqual(["archived", "published", true, false, "2026-03-01T12:00:00Z"]);
    expect(await photos(b.id)).toHaveLength(1);
    // an already archived absent gallery is not counted again
    const r3 = await runSync(e, { drive: d, force: true, now: LATER });
    expect(r3.galleries.archived).toBe(0);
  });

  it("a returning folder restores only sync-archived galleries", async () => {
    const d = newDrive();
    await runSync(e, { drive: d, now: NOW });
    const keep = entries().filter((x) => x.id !== "beta");
    const gone = createMockDrive({ rootId: ROOT, entries: keep });
    await runSync(e, { drive: gone, force: true, now: NOW });
    await runSync(e, { drive: gone, force: true, now: LATER });
    expect((await gal("beta")).status).toBe("archived");
    const r = await runSync(e, { drive: newDrive(), force: true, now: LATER });
    expect(r.galleries.updated).toBe(1);
    const b = await gal("beta");
    expect([b.status, b.archivedBySync, b.folderMissingSince]).toEqual([
      "published",
      false,
      null,
    ]);
  });

  it("an admin-archived gallery stays archived when its folder is present", async () => {
    const d = newDrive();
    await runSync(e, { drive: d, now: NOW });
    await db
      .update(schema.galleries)
      .set({ status: "archived" })
      .where(eq(schema.galleries.slug, "beta"));
    await runSync(e, { drive: d, force: true, now: NOW });
    expect((await gal("beta")).status).toBe("archived");
  });

  it("tombstoned folders are not created, not updated, not marked missing", async () => {
    await db.insert(schema.ignoredFolders).values({ driveFolderId: "beta" });
    const d = newDrive();
    const r = await runSync(e, { drive: d, now: NOW });
    expect(r.galleries.created).toBe(1);
    expect(await gal("beta")).toBeUndefined();
    // existing gallery whose folder becomes tombstoned: untouched, never "missing"
    await db.delete(schema.ignoredFolders);
    await runSync(e, { drive: d, force: true, now: NOW });
    await db.insert(schema.ignoredFolders).values({ driveFolderId: "beta" });
    d.removeFile("beta");
    await runSync(e, { drive: d, force: true, now: LATER });
    await runSync(e, { drive: d, force: true, now: LATER });
    const b = await gal("beta");
    expect([b.status, b.folderMissingSince]).toEqual(["published", null]);
  });

  it("empty root with galleries: skipped, nothing written, token and lock state kept", async () => {
    await runSync(e, { drive: newDrive(), now: NOW });
    const tok = await setting("drive_changes_token");
    const empty = createMockDrive({
      rootId: ROOT,
      entries: [{ ...folder(ROOT, "root", ""), parentId: null }],
    });
    const r = await runSync(e, { drive: empty, force: true, now: LATER });
    expect(r.skipped).toBe("empty_root");
    expect(r.galleries).toEqual({ created: 0, updated: 0, archived: 0 });
    expect(await setting("drive_changes_token")).toBe(tok);
    expect(await setting("sync_lock")).toBeUndefined();
    expect((await gal(ALPHA)).folderMissingSince).toBeNull();
  });
});

describe("T-refactor-runSync: lock, pending R2 flush, token, change detection", () => {
  it("a live lock skips without touching anything and keeps the other owner's lock", async () => {
    const lock = "2099-01-01T00:00:00Z|someone";
    await db.insert(schema.settings).values({ key: "sync_lock", value: lock });
    const r = await runSync(e, { drive: newDrive(), now: NOW });
    expect(r).toEqual({
      galleries: { created: 0, updated: 0, archived: 0 },
      photos: { added: 0, updated: 0, removed: 0 },
      issues: 0,
      subrequests: 0,
      skipped: "locked",
    });
    expect(await setting("sync_lock")).toBe(lock);
    expect(await gal(ALPHA)).toBeUndefined();
  });

  it("an expired lock is taken over and released; no_root releases too", async () => {
    await db
      .insert(schema.settings)
      .values({ key: "sync_lock", value: "2000-01-01T00:00:00Z|old" });
    await runSync(e, { drive: newDrive(), now: NOW });
    expect(await setting("sync_lock")).toBeUndefined();
    await db
      .delete(schema.settings)
      .where(eq(schema.settings.key, "drive_root_id"));
    const r = await runSync({ ...e, DRIVE_MODE: "google" } as Env, {
      drive: newDrive(),
      now: NOW,
    });
    expect(r.skipped).toBe("no_root");
    expect(await setting("sync_lock")).toBeUndefined();
  });

  it("pending R2 ids from a previous run are flushed first (keys deleted, setting dropped), even when the run is skipped", async () => {
    for (const id of ["p1", "p2"])
      for (const k of ["thumb", "view-sm", "view-lg"])
        await env.CACHE.put(`${id}/${k}`, "x");
    await db.insert(schema.settings).values({
      key: "r2_pending_deletes",
      value: JSON.stringify(["p1", "p2", 7]),
    });
    const empty = createMockDrive({
      rootId: ROOT,
      entries: [{ ...folder(ROOT, "root", ""), parentId: null }],
    });
    await runSync(e, { drive: empty, now: NOW }); // no galleries: proceeds and syncs nothing
    expect((await env.CACHE.list()).objects).toHaveLength(0);
    expect(await setting("r2_pending_deletes")).toBeUndefined();
  });

  it("a failed R2 cleanup persists the remainder in r2_pending_deletes and the run still succeeds", async () => {
    const d = newDrive();
    await runSync(e, { drive: d, now: NOW });
    const p = (await photos((await gal(ALPHA)).id)).find(
      (x) => x.baseName === "A2",
    )!;
    d.removeFile("a2");
    await runSync(e, { drive: d, force: true, now: NOW });
    const bad = {
      ...e,
      CACHE: new Proxy(env.CACHE, {
        get: (t, k) =>
          k === "delete"
            ? () => Promise.reject(new Error("r2 down"))
            : (t as never)[k] instanceof Function
              ? ((t as never)[k] as (...a: unknown[]) => unknown).bind(t)
              : (t as never)[k],
      }),
    } as Env;
    const r = await runSync(bad, { drive: d, force: true, now: LATER });
    expect(r.photos.removed).toBe(1);
    expect(JSON.parse((await setting("r2_pending_deletes"))!)).toEqual([p.id]);
    expect(await setting("sync_lock")).toBeUndefined();
    // next run retries first and clears it
    await env.CACHE.put(`${p.id}/thumb`, "x");
    await runSync(e, { drive: d, force: true, now: LATER });
    expect(await setting("r2_pending_deletes")).toBeUndefined();
    expect((await env.CACHE.list()).objects).toHaveLength(0);
  });

  it("unchanged token skips; pending missing photo or folder forces a rescan; token stored after success", async () => {
    const d = newDrive();
    await runSync(e, { drive: d, now: NOW });
    const t1 = await setting("drive_changes_token");
    const r = await runSync(e, { drive: d, now: NOW });
    expect(r.skipped).toBe("unchanged");
    expect(await setting("drive_changes_token")).toBe(t1);
    d.trashFile("a2");
    await runSync(e, { drive: d, now: NOW }); // sees the change, marks
    const t2 = await setting("drive_changes_token");
    expect(t2).not.toBe(t1);
    const r2 = await runSync(e, { drive: d, now: LATER }); // no Drive change, grace matures
    expect(r2.skipped).toBeUndefined();
    expect(r2.photos.removed).toBe(1);
  });

  it("budget exhausted while scanning: throws, DB untouched, token not stored, lock released", async () => {
    await expect(
      runSync(e, { drive: newDrive(), budget: 2, now: NOW }),
    ).rejects.toThrow(/budget/i);
    expect(await gal(ALPHA)).toBeUndefined();
    expect(await setting("drive_changes_token")).toBeUndefined();
    expect(await setting("sync_lock")).toBeUndefined();
  });

  it("error mid-run: committed gallery batches stay, token not stored, lock released, next run converges", async () => {
    const rec = recordingEnv(2); // 1st batch ok (alpha), 2nd throws (beta)
    const d = newDrive();
    await expect(runSync(rec.ec, { drive: d, now: NOW })).rejects.toThrow(
      "boom",
    );
    expect(await gal(ALPHA)).toBeDefined();
    expect(await gal("beta")).toBeUndefined();
    expect(await setting("drive_changes_token")).toBeUndefined();
    expect(await setting("sync_lock")).toBeUndefined();
    const r = await runSync(e, { drive: d, now: NOW });
    expect(r.galleries.created).toBe(1);
    expect(await names(ALPHA)).toHaveLength(3);
    expect(await names("beta")).toHaveLength(1);
  });

  it("issues: counted per album in result.issues, highres_empty added when the high-res folder empties", async () => {
    const d = newDrive();
    const r1 = await runSync(e, { drive: d, now: NOW });
    expect(r1.issues).toBe(7);
    const before = await names("beta");
    d.removeFile("b1");
    const r2 = await runSync(e, { drive: d, force: true, now: LATER });
    const b = await gal("beta");
    expect(JSON.parse(b.syncIssuesJson!)).toEqual(
      expect.arrayContaining([
        { type: "highres_empty", set: null, name: "high-res" },
      ]),
    );
    expect(r2.issues).toBeGreaterThanOrEqual(1);
    expect(await names("beta")).toEqual(before); // photos untouched
  });
});

describe("T-refactor-runSync: exact SQL sequence (golden)", () => {
  it("first sync, change run (rename/remove/new/gone folder), grace-matured run", async () => {
    const rec = recordingEnv();
    const d = newDrive();
    const out: string[] = [];
    const run = async (label: string, o: Parameters<typeof runSync>[1]) => {
      const start = rec.log.length;
      const res = await runSync(rec.ec, o);
      out.push(
        `## ${label}`,
        rec.normalized().split("\n").slice(start).join("\n"),
        JSON.stringify({ ...res, subrequests: res.subrequests }),
      );
    };
    await run("first", { drive: d, now: NOW });
    d.renameFile("a3", "A3x.jpg");
    d.trashFile("a2");
    d.addFile("b-hr", jpg("b2", "B2.jpg", "b-hr"));
    d.addFile("a-hr", jpg("n1", "N1.jpg", "a-hr"));
    d.removeFile("a1t"); // variant change -> update
    d.removeFile("beta");
    await run("changes", { drive: d, now: NOW });
    await run("matured", { drive: d, force: true, now: LATER });
    expect(out.join("\n")).toMatchSnapshot();
  });
});
