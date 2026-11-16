import { describe, expect, it, vi } from "vitest";
import { downloadBulk } from "../../../app/lib/download-client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function net(opts: {
  ids: string[];
  file?: (id: string, n: number) => Response;
  log?: string[];
}) {
  const counts = new Map<string, number>();
  let tokenCalls = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    opts.log?.push(url.split("/").pop()!);
    if (url.endsWith("/bulk"))
      return json({ bulkId: "b1", photoIds: opts.ids });
    if (url.endsWith("/download-tokens")) {
      tokenCalls++;
      const body = JSON.parse(String(init?.body));
      return json({
        tokens: body.photoIds.map((id: string) => ({
          photoId: id,
          url: `/dl/t${tokenCalls}-${id}`,
          filename: `${id}.jpg`,
        })),
        missing: [],
        unavailable: [],
      });
    }
    const id = url.replace(/^\/dl\/t\d+-/, "");
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    return opts.file ? opts.file(id, n) : new Response("data");
  });
  return fetch;
}

describe("T3.2 adversarial", () => {
  it("opens showSaveFilePicker before the POST /bulk round-trip (user activation)", async () => {
    const log: string[] = [];
    const fetch = net({ ids: ["a"], log });
    const picker = vi.fn(async () => {
      log.push("picker");
      throw new DOMException("no activation", "SecurityError");
    });
    await downloadBulk({
      slug: "s",
      scope: "all",
      variant: "web",
      deps: {
        fetch,
        showSaveFilePicker: picker as never,
        saveBlob: () => {},
        sleep: async () => {},
      },
    });
    expect(log.indexOf("picker")).toBe(0);
  });

  it("does not use a folder name of '..' (zip-slip)", async () => {
    const fetch = net({ ids: ["a", "b"] });
    let blob: Blob | undefined;
    await downloadBulk({
      slug: "s",
      scope: "all",
      variant: "web",
      sets: new Map([
        ["a", ".."],
        ["b", "Fiesta"],
      ]),
      deps: {
        fetch,
        saveBlob: (b) => (blob = b),
        sleep: async () => {},
        showSaveFilePicker: undefined,
      },
    });
    const text = new TextDecoder("latin1").decode(
      new Uint8Array(await blob!.arrayBuffer()),
    );
    expect(text).not.toContain("../");
  });

  // Fixture fixed (orchestrator): only the first token set 410s; files themselves succeed.
  it("re-requests tokens when a queued token expires (410) mid-bulk instead of failing the photo", async () => {
    const fetch = net({
      ids: ["a"],
      file: () => new Response("ok"),
    });
    // first token set always 410 ("expired"); a fresh token set would succeed.
    const f2 = vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const url = String(i);
      if (url.startsWith("/dl/t1-")) return new Response("x", { status: 410 });
      return fetch(i, init);
    });
    const r = await downloadBulk({
      slug: "s",
      scope: "all",
      variant: "web",
      deps: {
        fetch: f2,
        saveBlob: () => {},
        sleep: async () => {},
        showSaveFilePicker: undefined,
      },
    });
    expect(r.failed).toEqual([]);
  });

  it("honours Retry-After on 429 from /dl", async () => {
    const sleeps: number[] = [];
    const fetch = net({
      ids: ["a"],
      file: (_id, n) =>
        n === 1
          ? new Response("slow", {
              status: 429,
              headers: { "Retry-After": "30" },
            })
          : new Response("ok"),
    });
    await downloadBulk({
      slug: "s",
      scope: "all",
      variant: "web",
      deps: {
        fetch,
        saveBlob: () => {},
        sleep: async (ms) => void sleeps.push(ms),
        showSaveFilePicker: undefined,
      },
    });
    expect(Math.max(...sleeps)).toBeGreaterThanOrEqual(30_000);
  });
});
