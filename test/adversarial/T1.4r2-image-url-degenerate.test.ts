import { describe, expect, it } from "vitest";
import { createMockDrive, mockImageUrl } from "../../app/lib/server/drive-mock";
import { buildFixtures } from "../../app/lib/server/fixtures";

describe("T1.4r2", () => {
  it("mockImageUrl with 0x0 / missing dimensions yields a valid URL (fixtures include photos without metadata)", () => {
    expect(mockImageUrl("p", "web", 0, 0)).not.toMatch(/NaN/);
    expect(
      mockImageUrl(
        "p",
        "web",
        undefined as unknown as number,
        undefined as unknown as number,
      ),
    ).not.toMatch(/NaN/);
  });
  it("addFile with empty-string id is rejected or generated", () => {
    const fx = buildFixtures();
    const d = createMockDrive(fx);
    const f = d.addFile(fx.rootId, { id: "", name: "a.jpg" });
    expect(f.id).not.toBe("");
  });
  it("children of a trashed folder are not listed via the trashed ancestor", async () => {
    const fx = buildFixtures();
    const d = createMockDrive(fx);
    const album = (await d.listChildren(fx.rootId))[0];
    const sub = (await d.listChildren(album.id)).find((x) =>
      x.mimeType.endsWith("folder"),
    )!;
    d.trashFile(sub.id);
    expect((await d.listChildren(album.id)).map((x) => x.id)).not.toContain(
      sub.id,
    );
  });
});
