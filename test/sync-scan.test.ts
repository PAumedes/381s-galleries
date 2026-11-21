import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../app/lib/server/drive-types";
import type { MockEntry } from "../app/lib/server/fixtures";
import { runSync, SyncBudgetError } from "../app/lib/server/sync";

/** T6.38: pins what the Drive scan (root -> albums -> recipes -> sets) yields. */
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const NOW = new Date("2026-03-01T12:00:00Z");
const T = "2026-01-01T00:00:00.000Z";
const ROOT = "root";

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
const rootEntry = (): MockEntry => ({
  ...folder(ROOT, "root", ""),
  parentId: null,
});

const tree = (extra: MockEntry[] = []) =>
  createMockDrive({
    rootId: ROOT,
    entries: [
      rootEntry(),
      folder("alb", "Album", ROOT),
      folder("hr", "high-res", "alb"),
      jpg("p1", "P1.jpg", "hr"),
      jpg("gone", "Gone.jpg", "hr"),
      { ...jpg("trash", "Trash.jpg", "hr"), trashed: true },
      folder("hr-set", "Ceremony", "hr"),
      jpg("p2", "P2.jpg", "hr-set"),
      folder("deep", "Nested", "hr-set"),
      folder("misc", "Misc", "alb"),
      { ...jpg("note", "notes.jpg", "alb") },
      ...extra,
    ],
  });

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.delete(schema.ignoredFolders);
  await db.delete(schema.settings);
  await db
    .insert(schema.settings)
    .values({ key: "drive_root_id", value: ROOT });
});

describe("T6.38 sync scan", () => {
  it("builds albums, sets and issues; skips trashed; costs 4 list calls + root meta", async () => {
    const drive = tree();
    const r = await runSync(e, { drive, now: NOW, force: true });
    expect(r.galleries.created).toBe(1);
    const photos = await db.select().from(schema.photos);
    expect(
      photos.map((p) => `${p.setName}/${p.baseName}`).sort(),
    ).toMatchInlineSnapshot(`
      [
        "Ceremony/P2",
        "Highlights/Gone",
        "Highlights/P1",
      ]
    `);
    const [g] = await db.select().from(schema.galleries);
    expect(JSON.parse(g.syncIssuesJson ?? "[]")).toMatchInlineSnapshot(`
      [
        {
          "name": "P2",
          "set": "Ceremony",
          "type": "missing_thumb",
        },
        {
          "name": "Gone",
          "set": "Highlights",
          "type": "missing_thumb",
        },
        {
          "name": "P1",
          "set": "Highlights",
          "type": "missing_thumb",
        },
        {
          "name": "P2",
          "set": "Ceremony",
          "type": "missing_web",
        },
        {
          "name": "Gone",
          "set": "Highlights",
          "type": "missing_web",
        },
        {
          "name": "P1",
          "set": "Highlights",
          "type": "missing_web",
        },
        {
          "name": "notes.jpg",
          "set": null,
          "type": "stray_file",
        },
        {
          "name": "Misc",
          "set": null,
          "type": "unknown_folder",
        },
        {
          "name": "Nested",
          "set": "Ceremony",
          "type": "unknown_folder",
        },
      ]
    `);
    expect(r.subrequests).toMatchInlineSnapshot(`5`);
  });

  it("a root that is not a folder aborts with a 400 before any write", async () => {
    const drive = createMockDrive({
      rootId: ROOT,
      entries: [{ ...jpg(ROOT, "root.jpg", ""), parentId: null }],
    });
    await expect(runSync(e, { drive, now: NOW, force: true })).rejects.toThrow(
      /usable folder/,
    );
    expect(await db.select().from(schema.galleries)).toEqual([]);
  });

  it("budget 1 fails before the album listing and writes nothing", async () => {
    await expect(
      runSync(e, { drive: tree(), now: NOW, force: true, budget: 1 }),
    ).rejects.toBeInstanceOf(SyncBudgetError);
    expect(await db.select().from(schema.galleries)).toEqual([]);
  });
});
