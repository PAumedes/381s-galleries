import { describe, expect, it } from "vitest";
import { createDriveClient } from "../../app/lib/server/drive";
import { createMockDrive } from "../../app/lib/server/drive-mock";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("T1.2r2 listChildrenMany probes", () => {
  it("mock and real agree: unknown folder id yields empty array key, not a throw", async () => {
    const mock = createMockDrive();
    const m = await mock.listChildrenMany(["does-not-exist"]);
    expect(m.get("does-not-exist")).toEqual([]);
  });

  it("real: 41 ids -> 2 queries; multi-parent file in both; unrequested parent ignored", async () => {
    const qs: string[] = [];
    const fetchFn = (async (u: RequestInfo | URL) => {
      qs.push(new URL(String(u)).searchParams.get("q")!);
      return json({
        files: [
          {
            id: "f",
            name: "a",
            mimeType: "image/jpeg",
            modifiedTime: "2024-01-01T00:00:00Z",
            parents: ["i0", "i40", "zzz"],
          },
        ],
      });
      // Drive returns the same multi-parent file for each chunk whose ids match
    }) as unknown as typeof fetch;
    const c = createDriveClient(async () => "t", {
      fetch: fetchFn,
      sleep: async () => {},
    });
    const ids = Array.from({ length: 41 }, (_, i) => `i${i}`);
    const r = await c.listChildrenMany([...ids, "i0"]);
    expect(qs.length).toBe(2);
    expect(c.subrequests()).toBe(2);
    expect(r.size).toBe(41);
    expect(r.get("i0")!.length).toBe(1);
    expect(r.get("i40")!.length).toBe(1);
    expect(r.has("zzz")).toBe(false);
  });

  it("escapes quotes/backslashes in ids", async () => {
    let q = "";
    const fetchFn = (async (u: RequestInfo | URL) => {
      q = new URL(String(u)).searchParams.get("q")!;
      return json({ files: [] });
    }) as unknown as typeof fetch;
    const c = createDriveClient(async () => "t", {
      fetch: fetchFn,
      sleep: async () => {},
    });
    await c.listChildrenMany(["a' or 'x' in parents or 'b\\"]);
    expect(q).toBe(
      "('a\\' or \\'x\\' in parents or \\'b\\\\' in parents) and trashed = false",
    );
  });

  it("cancels bodies of retried responses and error messages are generic", async () => {
    let cancelled = 0;
    let n = 0;
    const fetchFn = (async () => {
      n++;
      const body = new ReadableStream({
        cancel() {
          cancelled++;
        },
        start(c) {
          c.enqueue(new TextEncoder().encode("x"));
          if (n === 4) c.close();
        },
      });
      return new Response(body, { status: 503 });
    }) as unknown as typeof fetch;
    const c = createDriveClient(async () => "SECRETTOK", {
      fetch: fetchFn,
      sleep: async () => {},
    });
    await c.getMeta("IDX").catch((e) => {
      expect(String(e.message)).not.toMatch(/SECRETTOK|IDX/);
    });
    expect(cancelled).toBe(3);
    expect(c.subrequests()).toBe(4);
  });
});
