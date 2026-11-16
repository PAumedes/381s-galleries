import { describe, expect, it } from "vitest";
import { createMockDrive, mockImageUrl } from "../../app/lib/server/drive-mock";
import { buildFixtures } from "../../app/lib/server/fixtures";
import { FOLDER_MIME } from "../../app/lib/server/drive-types";
import type { DriveFile } from "../../app/lib/server/drive-types";

describe("T1.4 adversarial", () => {
  it("ig fixtures have 1080 long edge for portrait too (PLAN 3 / 5.9)", () => {
    const fx = buildFixtures();
    const byId = new Map(fx.entries.map((e) => [e.id, e]));
    const bad = fx.entries.filter((e) => {
      if (e.mimeType === FOLDER_MIME || !e.width || !e.height) return false;
      const p = byId.get(e.parentId!);
      let r = p;
      while (
        r &&
        byId.get(r.parentId!)?.name !== undefined &&
        !["high-res", "web", "ig", "thumb", "preview-wm"].includes(r.name)
      )
        r = byId.get(r.parentId!);
      return r?.name === "ig" && Math.max(e.width, e.height) !== 1080;
    });
    expect(bad.map((b) => `${b.name} ${b.width}x${b.height}`)).toEqual([]);
  });

  it("mockImageUrl takes (photoId, variant, width, height); variant picks the size", () => {
    expect(mockImageUrl("abc", "thumb", 1, 1)).toBe(
      "https://picsum.photos/seed/abc/600/600",
    );
  });

  it("same photo in different variants gets the same picsum seed", () => {
    const seeds = (["highres", "thumb"] as const).map(
      (v) => new URL(mockImageUrl("photo-1", v, 3, 2)).pathname.split("/")[2],
    );
    expect(seeds[0]).toBe(seeds[1]);
  });

  // Drive-id leak is enforced at the route level (Phase 2 /img and /dl tests):
  // the redirect seed must equal the DB photo id, never drive_*_id.

  it("streamFile honours contract: status 200 or 206", async () => {
    const fx = buildFixtures();
    const d = createMockDrive(fx);
    const file = fx.entries.find((e) => e.mimeType === "image/jpeg")!;
    const res = await d.streamFile(file.id, { range: "bytes=0-9" });
    expect([200, 206]).toContain(res.status);
  });

  it("adding a file bumps the parent folder modifiedTime like real Drive", async () => {
    const fx = buildFixtures();
    const d = createMockDrive(fx);
    const album = (await d.listChildren(fx.rootId))[0];
    const before = (await d.getMeta(album.id)).modifiedTime;
    d.addFile(album.id, { name: "x.jpg" });
    expect((await d.getMeta(album.id)).modifiedTime).not.toBe(before);
  });

  it("addFile with an existing id must not silently overwrite", () => {
    const fx = buildFixtures();
    const d = createMockDrive(fx);
    const existing = fx.entries.find(
      (e) => e.mimeType === FOLDER_MIME && e.parentId,
    )!;
    expect(() =>
      d.addFile(fx.rootId, { id: existing.id, name: "dup.jpg" }),
    ).toThrow();
  });

  it("fixtures cover Drive quirks: missing imageMediaMetadata, identical duplicate names, shortcut, trashed", () => {
    const fx = buildFixtures();
    const imgs = fx.entries.filter((e) => e.mimeType === "image/jpeg");
    expect(imgs.some((e) => e.width === undefined)).toBe(true);
    const seen = new Set<string>();
    let dup = false;
    for (const e of fx.entries) {
      const k = `${e.parentId}|${e.name}`;
      if (seen.has(k)) dup = true;
      seen.add(k);
    }
    expect(dup).toBe(true);
    expect(
      fx.entries.some(
        (e) => e.mimeType === "application/vnd.google-apps.shortcut",
      ),
    ).toBe(true);
    expect(fx.entries.some((e) => e.trashed)).toBe(true);
  });

  it("takenAt is not after modifiedTime nonsense: photos modified before being taken", () => {
    const fx = buildFixtures();
    const bad = fx.entries.filter(
      (e: DriveFile) => e.takenAt && e.takenAt > e.modifiedTime,
    );
    expect(bad.length).toBe(0);
  });
});
