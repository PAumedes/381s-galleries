import { describe, expect, it, vi } from "vitest";
import { createDriveClient } from "../app/lib/server/drive";
import { DriveError } from "../app/lib/server/drive-types";

type Handler = (req: { url: URL; headers: Headers }, n: number) => Response;

function setup(handler: Handler, tokens = ["tok1", "tok2"]) {
  const calls: { url: URL; headers: Headers }[] = [];
  const fetchFn = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const rec = {
        url: new URL(String(input)),
        headers: new Headers(init?.headers),
      };
      calls.push(rec);
      return handler(rec, calls.length - 1);
    },
  );
  let t = 0;
  const getToken = vi.fn(async (force?: boolean) => {
    if (force) t = Math.min(t + 1, tokens.length - 1);
    return tokens[t];
  });
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  const client = createDriveClient(getToken, {
    fetch: fetchFn as unknown as typeof fetch,
    sleep,
  });
  return { client, calls, getToken, sleeps };
}

const json = (b: unknown, status = 200, h: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "content-type": "application/json", ...h },
  });
const gerr = (status: number, message: string, reason?: string) =>
  json(
    { error: { code: status, message, errors: reason ? [{ reason }] : [] } },
    status,
  );

const f = (id: string, extra: object = {}) => ({
  id,
  name: `${id}.jpg`,
  mimeType: "image/jpeg",
  size: "1234",
  modifiedTime: "2024-01-02T03:04:05.000Z",
  ...extra,
});

describe("listChildren", () => {
  it("paginates over 3 pages and maps fields", async () => {
    const { client, calls } = setup(({ url }) => {
      const p = url.searchParams.get("pageToken");
      if (!p) return json({ nextPageToken: "a", files: [f("1")] });
      if (p === "a") return json({ nextPageToken: "b", files: [f("2")] });
      return json({
        files: [
          f("3", {
            imageMediaMetadata: {
              width: 100,
              height: 50,
              time: "2023:05:06 07:08:09",
            },
          }),
        ],
      });
    });
    const files = await client.listChildren("folder");
    expect(files.map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect(calls).toHaveLength(3);
    expect(files[0].size).toBe(1234);
    expect(typeof files[0].size).toBe("number");
    expect(files[2].width).toBe(100);
    expect(files[2].height).toBe(50);
    expect(files[2].takenAt).toBe("2023-05-06T07:08:09Z");
  });

  it("sends the expected params and bearer token", async () => {
    const { client, calls } = setup(() => json({ files: [] }));
    await client.listChildren("abc");
    const u = calls[0].url;
    expect(u.origin + u.pathname).toBe(
      "https://www.googleapis.com/drive/v3/files",
    );
    expect(u.searchParams.get("q")).toBe(
      "'abc' in parents and trashed = false",
    );
    expect(u.searchParams.get("fields")).toBe(
      "nextPageToken,files(id,name,mimeType,size,modifiedTime,trashed,imageMediaMetadata(width,height,time,rotation))",
    );
    expect(u.searchParams.get("pageSize")).toBe("1000");
    expect(u.searchParams.get("supportsAllDrives")).toBe("true");
    expect(u.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(calls[0].headers.get("authorization")).toBe("Bearer tok1");
  });

  it("escapes backslash and quote in the id", async () => {
    const { client, calls } = setup(() => json({ files: [] }));
    await client.listChildren("a'b\\c' or '1'='1");
    expect(calls[0].url.searchParams.get("q")).toBe(
      "'a\\'b\\\\c\\' or \\'1\\'=\\'1' in parents and trashed = false",
    );
  });

  it("leaves takenAt undefined when EXIF time is unparsable", async () => {
    const { client } = setup(() =>
      json({
        files: [
          f("1", { imageMediaMetadata: { time: "garbage" } }),
          f("2", { imageMediaMetadata: { time: "2023:13:45 99:99:99" } }),
          f("3"),
        ],
      }),
    );
    const files = await client.listChildren("x");
    for (const x of files) expect(x.takenAt).toBeUndefined();
  });

  it("omits size for folders", async () => {
    const { client } = setup(() =>
      json({
        files: [
          {
            id: "d",
            name: "d",
            mimeType: "application/vnd.google-apps.folder",
            modifiedTime: "2024-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const [d] = await client.listChildren("x");
    expect(d.size).toBeUndefined();
  });
});

describe("getMeta", () => {
  it("encodes the id and returns trashed flag", async () => {
    const { client, calls } = setup(() => json(f("a/b", { trashed: true })));
    const m = await client.getMeta("a/b");
    expect(calls[0].url.pathname).toBe("/drive/v3/files/a%2Fb");
    expect(calls[0].url.searchParams.get("fields")).toBe(
      "id,name,mimeType,size,modifiedTime,trashed,imageMediaMetadata(width,height,time,rotation)",
    );
    expect(calls[0].url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(m.trashed).toBe(true);
  });

  it("404 -> DriveError(404) with generic message and separate detail", async () => {
    const { client } = setup(() => gerr(404, "File not found: zzz."));
    const e = await client.getMeta("zzz").catch((x) => x);
    expect(e).toBeInstanceOf(DriveError);
    expect(e.status).toBe(404);
    expect(e.message).toBe("Drive request failed (404)");
    expect(e.message).not.toContain("zzz");
    expect(e.detail).toContain("File not found");
  });

  it("swaps width/height for rotation 1 and 3 only", async () => {
    for (const [rot, w, h] of [
      [0, 100, 50],
      [1, 50, 100],
      [2, 100, 50],
      [3, 50, 100],
    ]) {
      const { client } = setup(() =>
        json(
          f("a", {
            imageMediaMetadata: { width: 100, height: 50, rotation: rot },
          }),
        ),
      );
      const m = await client.getMeta("a");
      expect([m.width, m.height]).toEqual([w, h]);
    }
  });

  it("size accepts numbers and digit strings only", async () => {
    for (const [size, want] of [
      [12, 12],
      ["34", 34],
      ["", undefined],
      ["1e3", undefined],
      ["-5", undefined],
      ["abc", undefined],
      [null, undefined],
    ]) {
      const { client } = setup(() => json(f("a", { size })));
      expect((await client.getMeta("a")).size).toBe(want);
    }
  });

  it("non-JSON 2xx -> DriveError(502)", async () => {
    const { client } = setup(() => new Response("<html>", { status: 200 }));
    await expect(client.getMeta("a")).rejects.toMatchObject({ status: 502 });
  });

  it("network errors retried then wrapped as DriveError(503); counted", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("boom");
    });
    const client = createDriveClient(async () => "tok", {
      fetch: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });
    const e = await client.getMeta("a").catch((x) => x);
    expect(e).toBeInstanceOf(DriveError);
    expect(e.status).toBe(503);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(client.subrequests()).toBe(4);
  });

  it("subrequests counts retries", async () => {
    const { client } = setup((_, n) =>
      n === 0 ? gerr(503, "x") : json(f("a")),
    );
    await client.getMeta("a");
    expect(client.subrequests()).toBe(2);
  });

  it("pagination caps at 50 pages", async () => {
    let n = 0;
    const { client, calls } = setup(() =>
      json({ nextPageToken: `t${n++}`, files: [] }),
    );
    await expect(client.listChildren("F")).rejects.toMatchObject({
      status: 502,
    });
    expect(calls.length).toBeLessThanOrEqual(50);
  });
});

describe("listChildrenMany", () => {
  it("one query for several folders, groups by parents, fills empties", async () => {
    const { client, calls } = setup(() =>
      json({
        files: [
          f("1", { parents: ["A"] }),
          f("2", { parents: ["B"] }),
          f("3", { parents: ["A"] }),
        ],
      }),
    );
    const m = await client.listChildrenMany(["A", "B", "C"]);
    expect(calls).toHaveLength(1);
    const q = calls[0].url.searchParams.get("q");
    expect(q).toBe(
      "('A' in parents or 'B' in parents or 'C' in parents) and trashed = false",
    );
    expect(calls[0].url.searchParams.get("fields")).toContain("parents");
    expect(m.get("A")?.map((x) => x.id)).toEqual(["1", "3"]);
    expect(m.get("B")?.map((x) => x.id)).toEqual(["2"]);
    expect(m.get("C")).toEqual([]);
  });

  it("chunks 40 ids per query", async () => {
    const ids = Array.from({ length: 85 }, (_, i) => `id${i}`);
    const { client, calls } = setup(() => json({ files: [] }));
    const m = await client.listChildrenMany(ids);
    expect(calls).toHaveLength(3);
    expect(m.size).toBe(85);
    expect(client.subrequests()).toBe(3);
  });
});

describe("streamFile retry policy", () => {
  it("does not retry once a Response exists (5xx)", async () => {
    const { client, calls } = setup(() => gerr(503, "down"));
    await expect(client.streamFile("a")).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);
  });

  it("retries when fetch itself throws", async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => {
      if (n++ === 0) throw new TypeError("net");
      return new Response("x", { status: 200 });
    });
    const client = createDriveClient(async () => "tok", {
      fetch: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });
    expect((await client.streamFile("a")).status).toBe(200);
  });
});

describe("streamFile", () => {
  it("returns the upstream response unconsumed, forwards Range, keeps 206", async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.close();
      },
    });
    const upstream = new Response(body, {
      status: 206,
      headers: { "content-range": "bytes 0-2/10" },
    });
    const { client, calls } = setup(() => upstream);
    const res = await client.streamFile("id1", { range: "bytes=0-2" });
    expect(res).toBe(upstream);
    expect(res.status).toBe(206);
    expect(res.bodyUsed).toBe(false);
    expect(res.body).toBe(body);
    expect(calls[0].url.pathname).toBe("/drive/v3/files/id1");
    expect(calls[0].url.searchParams.get("alt")).toBe("media");
    expect(calls[0].headers.get("range")).toBe("bytes=0-2");
    expect(calls[0].headers.get("authorization")).toBe("Bearer tok1");
  });

  it("omits Range when not given", async () => {
    const { client, calls } = setup(() => new Response("x", { status: 200 }));
    await client.streamFile("id1");
    expect(calls[0].headers.has("range")).toBe(false);
  });

  it("errors throw DriveError", async () => {
    const { client } = setup(() => gerr(404, "nope"));
    await expect(client.streamFile("q")).rejects.toMatchObject({ status: 404 });
  });
});

describe("changes", () => {
  it("getStartPageToken", async () => {
    const { client, calls } = setup(() => json({ startPageToken: "77" }));
    expect(await client.getStartPageToken()).toBe("77");
    expect(calls[0].url.pathname).toBe("/drive/v3/changes/startPageToken");
    expect(calls[0].url.searchParams.get("supportsAllDrives")).toBe("true");
  });

  it("pages until newStartPageToken; changed true if any change", async () => {
    const { client, calls } = setup(({ url }) => {
      const p = url.searchParams.get("pageToken");
      if (p === "t0") return json({ nextPageToken: "t1", changes: [] });
      if (p === "t1")
        return json({ nextPageToken: "t2", changes: [{ fileId: "x" }] });
      return json({ newStartPageToken: "t9", changes: [] });
    });
    const r = await client.listChanges("t0");
    expect(r).toEqual({ changed: true, newStartPageToken: "t9" });
    expect(calls).toHaveLength(3);
    expect(calls[0].url.pathname).toBe("/drive/v3/changes");
    expect(calls[0].url.searchParams.get("fields")).toBe(
      "nextPageToken,newStartPageToken,changes(fileId)",
    );
    expect(calls[0].url.searchParams.get("pageSize")).toBe("1000");
  });

  it("changed false when none", async () => {
    const { client } = setup(() =>
      json({ newStartPageToken: "n", changes: [] }),
    );
    expect(await client.listChanges("t")).toEqual({
      changed: false,
      newStartPageToken: "n",
    });
  });
});

describe("auth and retries", () => {
  it("401 refreshes the token once and retries", async () => {
    const { client, calls, getToken } = setup((_, n) =>
      n === 0 ? gerr(401, "Invalid Credentials") : json(f("a")),
    );
    await client.getMeta("a");
    expect(getToken).toHaveBeenCalledWith(true);
    expect(calls[0].headers.get("authorization")).toBe("Bearer tok1");
    expect(calls[1].headers.get("authorization")).toBe("Bearer tok2");
  });

  it("second 401 throws DriveError(401) without looping", async () => {
    const { client, calls } = setup(() => gerr(401, "Invalid Credentials"));
    await expect(client.getMeta("a")).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(2);
  });

  it("429 retries with backoff then succeeds, honouring Retry-After", async () => {
    const { client, calls, sleeps } = setup((_, n) =>
      n === 0
        ? json({ error: { message: "slow" } }, 429, { "retry-after": "2" })
        : n === 1
          ? gerr(429, "slow")
          : json(f("a")),
    );
    await client.getMeta("a");
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(2000);
    expect(sleeps[1]).toBeGreaterThan(0);
  });

  it("403 rateLimitExceeded is retried; other 403 is not", async () => {
    const a = setup((_, n) =>
      n === 0 ? gerr(403, "rl", "userRateLimitExceeded") : json(f("a")),
    );
    await a.client.getMeta("a");
    expect(a.calls).toHaveLength(2);
    const b = setup(() => gerr(403, "forbidden", "forbidden"));
    await expect(b.client.getMeta("a")).rejects.toMatchObject({ status: 403 });
    expect(b.calls).toHaveLength(1);
  });

  it("5xx exhausted after 3 retries -> DriveError", async () => {
    const { client, calls, sleeps } = setup(() => gerr(503, "backend down"));
    const e = await client.getMeta("a").catch((x) => x);
    expect(e).toBeInstanceOf(DriveError);
    expect(e.status).toBe(503);
    expect(calls).toHaveLength(4);
    expect(sleeps).toHaveLength(3);
  });

  it("non-JSON error body still yields DriveError", async () => {
    const { client } = setup(
      () => new Response("<html>bad</html>", { status: 400 }),
    );
    await expect(client.getMeta("a")).rejects.toMatchObject({ status: 400 });
  });

  it("never leaks the access token in error messages", async () => {
    const { client } = setup(() => gerr(500, "boom"), ["SECRET-TOKEN-xyz"]);
    const e = await client.getMeta("a").catch((x) => x);
    expect(String(e.message)).not.toContain("SECRET-TOKEN-xyz");
    const s = setup(
      () => new Response("Bearer SECRET-TOKEN-xyz", { status: 400 }),
      ["SECRET-TOKEN-xyz"],
    );
    const e2 = await s.client.getMeta("a").catch((x) => x);
    expect(String(e2.message)).not.toContain("SECRET-TOKEN-xyz");
  });
});

describe("T6.53d streamFile: If-Range and the error reason", () => {
  it("sends If-Range only together with a Range", async () => {
    const { client, calls } = setup(() => new Response("x", { status: 206 }));
    await client.streamFile("a", { range: "bytes=0-1", ifRange: '"e1"' });
    await client.streamFile("a", { ifRange: '"e1"' });
    expect(calls[0].headers.get("If-Range")).toBe('"e1"');
    expect(calls[1].headers.get("If-Range")).toBeNull();
    expect(calls[1].headers.get("Range")).toBeNull();
  });

  it("a non-quota 403 carries its Drive reason (log-side), a quota one too", async () => {
    const { client } = setup(() => gerr(403, "nope", "cannotDownloadFile"));
    await expect(client.streamFile("a")).rejects.toMatchObject({
      status: 403,
      reason: "cannotDownloadFile",
    });
  });
});
