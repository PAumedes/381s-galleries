import type { MockEntry } from "../../app/lib/server/fixtures";
import { describe, expect, it } from "vitest";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../../app/lib/server/drive-types";
import { runSync } from "../../app/lib/server/sync";
import { e, galleryBy, photosOf, ROOT, setup } from "./T1.3-helpers";

setup();

describe("T1.3 big galleries", () => {
  it("3000 photos sync, re-sync with all files re-exported, and issues JSON stays bounded", async () => {
    const T = "2026-01-01T00:00:00.000Z";
    const entries: MockEntry[] = [
      {
        id: ROOT(),
        name: "root",
        mimeType: FOLDER_MIME,
        modifiedTime: T,
        parentId: null,
      },
      {
        id: "a",
        name: "Big",
        mimeType: FOLDER_MIME,
        modifiedTime: T,
        parentId: ROOT(),
      },
      {
        id: "h",
        name: "high-res",
        mimeType: FOLDER_MIME,
        modifiedTime: T,
        parentId: "a",
      },
      {
        id: "t",
        name: "thumb",
        mimeType: FOLDER_MIME,
        modifiedTime: T,
        parentId: "a",
      },
    ];
    for (let i = 0; i < 3000; i++)
      entries.push({
        id: `h${i}`,
        name: `IMG_${i}.jpg`,
        mimeType: "image/jpeg",
        modifiedTime: T,
        parentId: "h",
        width: 2048,
        height: 1365,
      });
    for (let i = 0; i < 3000; i++)
      entries.push({
        id: `t${i}`,
        name: `ORPHAN_${i}.jpg`,
        mimeType: "image/jpeg",
        modifiedTime: T,
        parentId: "t",
      });
    const d = createMockDrive({ rootId: ROOT(), entries });
    await runSync(e, { drive: d });
    const g = await galleryBy("big");
    expect((await photosOf(g.id)).length).toBe(3000);
    expect((g.syncIssuesJson ?? "").length).toBeLessThan(100_000);
    for (let i = 0; i < 3000; i++) {
      d.removeFile(`h${i}`);
      d.addFile("h", { name: `IMG_${i}.jpg`, width: 2048, height: 1366 });
    }
    const r = await runSync(e, { drive: d, force: true });
    expect(r.photos.updated).toBe(3000);
  }, 120_000);
});
