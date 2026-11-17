import { describe, expect, it, vi } from "vitest";
import { downloadBulk, safeZipName } from "../../app/lib/download-client";

const json = (b: unknown) =>
  new Response(JSON.stringify(b), {
    headers: { "Content-Type": "application/json" },
  });

function run(fileFor: (url: string) => Response) {
  let n = 0;
  const bodies: unknown[] = [];
  const fetch = vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
    const url = String(i);
    if (url.endsWith("/bulk")) return json({ bulkId: "b", photoIds: ["a"] });
    if (url.endsWith("/download-tokens")) {
      bodies.push(JSON.parse(String(init?.body)));
      n++;
      return json({
        tokens: [{ photoId: "a", url: `/dl/t${n}`, filename: "a.jpg" }],
        missing: [],
        unavailable: [],
      });
    }
    return fileFor(url);
  });
  return {
    bodies,
    go: () =>
      downloadBulk({
        slug: "s",
        scope: "all",
        variant: "web",
        deps: {
          fetch,
          saveBlob: () => {},
          sleep: async () => {},
          showSaveFilePicker: undefined,
        },
      }),
  };
}

describe("bulk 410 refresh", () => {
  it("fetches a fresh token (with bulkId) once and succeeds", async () => {
    const t = run((u) =>
      u === "/dl/t1" ? new Response("x", { status: 410 }) : new Response("ok"),
    );
    const r = await t.go();
    expect(r.failed).toEqual([]);
    expect(t.bodies[1]).toMatchObject({ photoIds: ["a"], bulkId: "b" });
  });
  it("counts failed after a second 410", async () => {
    const t = run(() => new Response("x", { status: 410 }));
    expect((await t.go()).failed).toEqual(["a.jpg"]);
    expect(t.bodies).toHaveLength(2);
  });
});

describe("safeZipName", () => {
  it.each([
    ["..", "_"],
    [".", "_"],
    ["a/b\\c:d", "a b c d"],
    ["  x \t y. ", "x y"],
  ])("%j -> %j", (i, o) => expect(safeZipName(i)).toBe(o));
  it("limits to 120 code points", () =>
    expect(Array.from(safeZipName("😀".repeat(200))).length).toBe(120));
});
