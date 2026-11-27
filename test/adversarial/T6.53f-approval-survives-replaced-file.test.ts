import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { handleSetApproval } from "../../app/lib/server/approvals";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../../app/lib/server/drive-types";
import { runSync } from "../../app/lib/server/sync";
import { migrateDb } from "../support/d1";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const T0 = new Date("2026-03-01T12:00:00Z");
const drive = (modified: string) =>
  createMockDrive({
    rootId: "root",
    entries: [
      {
        id: "root",
        name: "root",
        mimeType: FOLDER_MIME,
        modifiedTime: modified,
        parentId: null,
      },
      {
        id: "alb",
        name: "Alb",
        mimeType: FOLDER_MIME,
        modifiedTime: modified,
        parentId: "root",
      },
      {
        id: "hr",
        name: "high-res",
        mimeType: FOLDER_MIME,
        modifiedTime: modified,
        parentId: "alb",
      },
      {
        id: "hr/IMG_1.jpg",
        name: "IMG_1.jpg",
        mimeType: "image/jpeg",
        modifiedTime: modified,
        parentId: "hr",
        width: 2000,
        height: 1000,
        size: 1000,
      },
    ],
  });

beforeAll(migrateDb);
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.delete(schema.settings);
  await db
    .insert(schema.settings)
    .values({ key: "drive_root_id", value: "root" });
});

describe("T6.53f adversary: approval of a version whose file was replaced", () => {
  it("re-exported file at the same version (same name, new content) re-opens the review", async () => {
    await db.insert(schema.galleries).values({
      id: "g1",
      driveFolderId: "alb",
      slug: "alb",
      title: "Alb",
      status: "published",
      versioning: true,
      requireEmail: false,
    });
    await runSync(e, {
      drive: drive("2026-01-01T00:00:00.000Z"),
      force: true,
      now: T0,
      budget: 200,
    });
    const [p] = await db.select().from(schema.photos);
    const res = await handleSetApproval(
      new Request("https://x.test/api/g/alb/approvals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "1.1.1.1",
        },
        body: JSON.stringify({ photoId: p.id, version: 1, on: true }),
      }),
      "alb",
      e,
    );
    expect(res.status).toBe(200);
    // Capture One re-exports IMG_1 over the same Drive file: new bytes, new modifiedTime.
    await runSync(e, {
      drive: drive("2026-02-01T00:00:00.000Z"),
      force: true,
      now: new Date(T0.getTime() + 3600_000),
      budget: 200,
    });
    const [v] = await db.select().from(schema.photoVersions);
    expect(v.driveVersions).toContain("2026-02-01");
    // The approval was for the OLD image; it must not silently carry over.
    expect(await db.select().from(schema.photoApprovals)).toEqual([]);
  });
});
