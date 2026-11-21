import { describe, expect, it, vi } from "vitest";
import { downloadBulk } from "../../app/lib/download-client";
import type { BulkProgress } from "../../app/lib/download-client";

/**
 * T6.38 characterization of downloadBulk: request log, progress events, zip
 * entry names and result for the paths the function branches on. Pins
 * behaviour while the function is split into named steps.
 */
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Script = {
  ids: string[];
  names?: Record<string, string>;
  missing?: string[];
  unavailable?: string[];
  file: (id: string, attempt: number, url: string) => Response;
  plan?: unknown;
};

function harness(s: Script) {
  const log: string[] = [];
  const attempts = new Map<string, number>();
  let fresh = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/bulk")) {
      log.push(`bulk ${init?.body}`);
      return json(s.plan ?? { bulkId: "b1", photoIds: s.ids, totalBytes: 10 });
    }
    if (url.endsWith("/download-tokens")) {
      const body = JSON.parse(String(init?.body));
      log.push(`tokens ${body.photoIds.join(",")} bulk=${body.bulkId}`);
      fresh++;
      const gone = new Set([...(s.missing ?? []), ...(s.unavailable ?? [])]);
      return json({
        tokens: body.photoIds
          .filter((i: string) => !gone.has(i))
          .map((id: string) => ({
            photoId: id,
            url: `/dl/${id}-${fresh}`,
            filename: s.names?.[id] ?? `${id}.jpg`,
          })),
        missing: s.missing ?? [],
        unavailable: s.unavailable ?? [],
      });
    }
    const id = url.replace("/dl/", "").replace(/-\d+$/, "");
    const a = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, a);
    log.push(`file ${url} #${a}`);
    return s.file(id, a, url);
  });
  const progress: string[] = [];
  const sleeps: number[] = [];
  const saved: { name: string; text: string }[] = [];
  const run = async (
    over: Record<string, unknown> & { deps?: Record<string, unknown> } = {},
  ) => {
    const { deps: extraDeps, ...rest } = over;
    const result = await downloadBulk({
      slug: "s",
      scope: "all",
      variant: "web",
      onProgress: (p: BulkProgress) =>
        progress.push(
          `${p.done}/${p.total} b=${p.bytes} f=${p.failed.join("|")}${p.waiting !== undefined ? ` w=${p.waiting}` : ""}`,
        ),
      deps: {
        fetch: fetch as unknown as typeof globalThis.fetch,
        sleep: async (ms: number) => void sleeps.push(ms),
        showSaveFilePicker: undefined,
        saveBlob: (blob: Blob, name: string) => {
          // jsdom Blob has no text(); the zip is stored uncompressed
          saved.push({ name, text: String(blob.size) });
          (saved as unknown as { blobs?: Blob[] }).blobs = [
            ...((saved as unknown as { blobs?: Blob[] }).blobs ?? []),
            blob,
          ];
        },
        ...extraDeps,
      },
      ...rest,
    });
    const blob = (saved as unknown as { blobs?: Blob[] }).blobs?.[0];
    const names = blob
      ? [
          ...new TextDecoder("latin1")
            .decode(await new Response(blob).arrayBuffer())
            .matchAll(/[A-Za-z0-9 ()_\-./]+\.jpg/g),
        ]
          .map((m) => m[0])
          .filter((n, i, a) => a.indexOf(n) === i)
      : [];
    return { result, log, progress, sleeps, saved: saved[0]?.name, names };
  };
  return { run };
}

const ok = (id: string) => new Response(`data-${id}`);

describe("T6.38 downloadBulk golden", () => {
  it("folders per set, duplicate names, missing/unavailable ids", async () => {
    const h = harness({
      ids: ["a", "b", "c", "d", "e"],
      names: { a: "same.jpg", b: "same.jpg", c: "../x:y.jpg", d: "d.jpg" },
      missing: ["e"],
      file: (id) => ok(id),
    });
    const out = await h.run({
      sets: new Map([
        ["a", "Ceremony"],
        ["b", "Ceremony"],
        ["c", "Party"],
        ["d", "party"],
      ]),
    });
    expect(out).toMatchInlineSnapshot(`
      {
        "log": [
          "bulk {"scope":"all","variant":"web"}",
          "tokens a,b,c,d,e bulk=b1",
          "file /dl/a-1 #1",
          "file /dl/b-1 #1",
          "file /dl/c-1 #1",
          "file /dl/d-1 #1",
        ],
        "names": [
          "Ceremony/same.jpg",
          "Ceremony/same (2).jpg",
          "Party/x y.jpg",
          "party (2)/d.jpg",
        ],
        "progress": [
          "0/5 b=0 f=",
          "1/5 b=0 f=e",
          "2/5 b=6 f=e",
          "3/5 b=12 f=e",
          "4/5 b=18 f=e",
          "5/5 b=24 f=e",
        ],
        "result": {
          "bytes": 24,
          "done": 5,
          "failed": [
            "e",
          ],
          "sink": "blob",
          "status": "done",
          "total": 5,
        },
        "saved": "s-web.zip",
        "sleeps": [],
      }
    `);
  });

  it("scope set sends the set and never makes folders", async () => {
    const h = harness({ ids: ["a"], file: (id) => ok(id) });
    const out = await h.run({
      scope: "set",
      set: "Ceremony",
      sets: new Map([["a", "Ceremony"]]),
    });
    expect(out).toMatchInlineSnapshot(`
      {
        "log": [
          "bulk {"scope":"set","set":"Ceremony","variant":"web"}",
          "tokens a bulk=b1",
          "file /dl/a-1 #1",
        ],
        "names": [
          "a.jpg",
        ],
        "progress": [
          "0/1 b=0 f=",
          "1/1 b=6 f=",
        ],
        "result": {
          "bytes": 6,
          "done": 1,
          "failed": [],
          "sink": "blob",
          "status": "done",
          "total": 1,
        },
        "saved": "s-Ceremony-web.zip",
        "sleeps": [],
      }
    `);
  });

  it("retries 500s with backoff, refreshes a 410 once, waits on 429, fails 404", async () => {
    const h = harness({
      ids: ["a", "b", "c", "d", "z"],
      file: (id, attempt, url) => {
        if (id === "a")
          return attempt < 3 ? new Response("x", { status: 500 }) : ok(id);
        if (id === "b")
          return url.endsWith("-1") || url.endsWith("-2")
            ? new Response("x", { status: 410 })
            : ok(id);
        if (id === "c")
          return attempt < 2
            ? new Response("x", {
                status: 429,
                headers: { "Retry-After": "2" },
              })
            : ok(id);
        if (id === "d") return new Response("x", { status: 404 });
        return new Response("x", { status: 500 });
      },
    });
    const out = await h.run();
    expect(out).toMatchInlineSnapshot(`
      {
        "log": [
          "bulk {"scope":"all","variant":"web"}",
          "tokens a,b,c,d,z bulk=b1",
          "file /dl/a-1 #1",
          "file /dl/a-1 #2",
          "file /dl/b-1 #1",
          "tokens b bulk=b1",
          "file /dl/a-1 #3",
          "file /dl/c-1 #1",
          "file /dl/c-1 #2",
          "file /dl/b-2 #2",
          "file /dl/d-1 #1",
          "file /dl/z-1 #1",
          "file /dl/z-1 #2",
          "file /dl/z-1 #3",
        ],
        "names": [
          "a.jpg",
          "c.jpg",
        ],
        "progress": [
          "0/5 b=0 f=",
          "0/5 b=0 f= w=2",
          "0/5 b=0 f=",
          "1/5 b=6 f=",
          "2/5 b=6 f=b.jpg",
          "3/5 b=12 f=b.jpg",
          "4/5 b=12 f=b.jpg|d.jpg",
          "5/5 b=12 f=b.jpg|d.jpg|z.jpg",
        ],
        "result": {
          "bytes": 12,
          "done": 5,
          "failed": [
            "b.jpg",
            "d.jpg",
            "z.jpg",
          ],
          "sink": "blob",
          "status": "done",
          "total": 5,
        },
        "saved": "s-web.zip",
        "sleeps": [
          500,
          1000,
          2000,
          500,
          1000,
        ],
      }
    `);
  });

  it("empty plan is done without a zip", async () => {
    const h = harness({
      ids: [],
      plan: { bulkId: null, photoIds: [] },
      file: (id) => ok(id),
    });
    expect(await h.run()).toMatchInlineSnapshot(`
      {
        "log": [
          "bulk {"scope":"all","variant":"web"}",
        ],
        "names": [],
        "progress": [
          "0/0 b=0 f=",
        ],
        "result": {
          "bytes": 0,
          "done": 0,
          "failed": [],
          "sink": null,
          "status": "done",
          "total": 0,
        },
        "saved": undefined,
        "sleeps": [],
      }
    `);
  });

  it("an already aborted run is cancelled before any request", async () => {
    const h = harness({ ids: ["a"], file: (id) => ok(id) });
    const ac = new AbortController();
    ac.abort();
    expect(await h.run({ signal: ac.signal })).toMatchInlineSnapshot(`
      {
        "log": [],
        "names": [],
        "progress": [],
        "result": {
          "bytes": 0,
          "done": 0,
          "failed": [],
          "sink": null,
          "status": "cancelled",
          "total": 0,
        },
        "saved": undefined,
        "sleeps": [],
      }
    `);
  });

  it("picker: written to the sink; a visitor cancel and a failure with a refused fallback both cancel", async () => {
    const chunks: Uint8Array[] = [];
    const sink = () => ({
      createWritable: async () =>
        new WritableStream<Uint8Array>({ write: (c) => void chunks.push(c) }),
    });
    const h1 = harness({ ids: ["a"], file: (id) => ok(id) });
    const used = await h1.run({
      deps: { showSaveFilePicker: async () => sink() },
    });
    const h2 = harness({ ids: ["a"], file: (id) => ok(id) });
    const cancelled = await h2.run({
      deps: {
        showSaveFilePicker: async () => {
          throw new DOMException("x", "AbortError");
        },
      },
    });
    const h3 = harness({ ids: ["a"], file: (id) => ok(id) });
    const confirmed: string[] = [];
    const refused = await h3.run({
      deps: {
        showSaveFilePicker: async () => {
          throw new Error("boom");
        },
      },
      confirmFallback: async () => (confirmed.push("asked"), false),
    });
    const h4 = harness({ ids: ["a"], file: (id) => ok(id) });
    const accepted = await h4.run({
      deps: {
        showSaveFilePicker: async () => {
          throw new Error("boom");
        },
      },
      confirmFallback: async () => true,
    });
    expect({
      used,
      cancelled,
      refused,
      confirmed,
      accepted,
      wrote: chunks.length > 0,
    }).toMatchInlineSnapshot(`
      {
        "accepted": {
          "log": [
            "bulk {"scope":"all","variant":"web"}",
            "tokens a bulk=b1",
            "file /dl/a-1 #1",
          ],
          "names": [
            "a.jpg",
          ],
          "progress": [
            "0/1 b=0 f=",
            "1/1 b=6 f=",
          ],
          "result": {
            "bytes": 6,
            "done": 1,
            "failed": [],
            "sink": "blob",
            "status": "done",
            "total": 1,
          },
          "saved": "s-web.zip",
          "sleeps": [],
        },
        "cancelled": {
          "log": [],
          "names": [],
          "progress": [],
          "result": {
            "bytes": 0,
            "done": 0,
            "failed": [],
            "sink": "picker",
            "status": "cancelled",
            "total": 0,
          },
          "saved": undefined,
          "sleeps": [],
        },
        "confirmed": [
          "asked",
        ],
        "refused": {
          "log": [],
          "names": [],
          "progress": [],
          "result": {
            "bytes": 0,
            "done": 0,
            "failed": [],
            "sink": "picker",
            "status": "cancelled",
            "total": 0,
          },
          "saved": undefined,
          "sleeps": [],
        },
        "used": {
          "log": [
            "bulk {"scope":"all","variant":"web"}",
            "tokens a bulk=b1",
            "file /dl/a-1 #1",
          ],
          "names": [],
          "progress": [
            "0/1 b=0 f=",
            "1/1 b=6 f=",
          ],
          "result": {
            "bytes": 6,
            "done": 1,
            "failed": [],
            "sink": "picker",
            "status": "done",
            "total": 1,
          },
          "saved": undefined,
          "sleeps": [],
        },
        "wrote": true,
      }
    `);
  });

  it("large in-memory runs ask confirmLarge; declining cancels with sink blob", async () => {
    const h = harness({
      ids: ["a"],
      plan: { bulkId: "b1", photoIds: ["a"], totalBytes: 2_000_000_000 },
      file: (id) => ok(id),
    });
    const asked: number[] = [];
    const out = await h.run({
      confirmLarge: async () => (asked.push(1), false),
    });
    expect({ out, asked }).toMatchInlineSnapshot(`
      {
        "asked": [
          1,
        ],
        "out": {
          "log": [
            "bulk {"scope":"all","variant":"web"}",
          ],
          "names": [],
          "progress": [],
          "result": {
            "bytes": 0,
            "done": 0,
            "failed": [],
            "sink": "blob",
            "status": "cancelled",
            "total": 1,
          },
          "saved": undefined,
          "sleeps": [],
        },
      }
    `);
  });
});
