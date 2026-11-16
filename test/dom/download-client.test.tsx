import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DownloadError,
  bulkWarning,
  downloadBulk,
  downloadSingle,
  requestTokens,
} from "../../app/lib/download-client";
import { EmailRequiredError } from "../../app/components/use-visitor";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const tick = () => new Promise((r) => setTimeout(r, 0));

type NetOpts = {
  n?: number;
  names?: Record<string, string>;
  failures?: Record<string, number>; // photoId -> number of failing attempts
  onFile?: (id: string, count: number) => void;
  bulk?: Response;
  totalBytes?: number;
};

function makeNet(o: NetOpts = {}) {
  const n = o.n ?? 3;
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const log: string[] = [];
  const attempts = new Map<string, number>();
  let inflight = 0;
  let max = 0;
  let files = 0;
  const bodies: unknown[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (url.endsWith("/bulk")) {
      bodies.push(JSON.parse(String(init?.body)));
      log.push("bulk");
      return (
        o.bulk ??
        json({
          bulkId: "b1",
          photoIds: ids,
          ...(o.totalBytes !== undefined ? { totalBytes: o.totalBytes } : {}),
        })
      );
    }
    if (url.endsWith("/download-tokens")) {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      log.push(`tokens:${body.photoIds.length}`);
      return json({
        tokens: body.photoIds.map((id: string) => ({
          photoId: id,
          url: `/dl/t-${id}`,
          filename: o.names?.[id] ?? `${id}.jpg`,
        })),
        missing: [],
        unavailable: [],
      });
    }
    const id = url.replace("/dl/t-", "");
    log.push(`file:${id}`);
    files++;
    o.onFile?.(id, files);
    const a = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, a);
    inflight++;
    max = Math.max(max, inflight);
    await tick();
    inflight--;
    if (a <= (o.failures?.[id] ?? 0)) return new Response("x", { status: 500 });
    return new Response(`data-${id}`, {
      headers: { "Content-Length": String(`data-${id}`.length) },
    });
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    mock: fetch,
    log,
    attempts,
    bodies,
    ids,
    maxInflight: () => max,
    files: () => files,
  };
}

function fakePicker() {
  const chunks: Uint8Array[] = [];
  const state = { aborted: false, closed: false, name: "" };
  const showSaveFilePicker = vi.fn(
    async (opts?: { suggestedName?: string }) => {
      state.name = opts?.suggestedName ?? "";
      return {
        createWritable: async () =>
          new WritableStream<Uint8Array>({
            write(c) {
              chunks.push(c);
            },
            close() {
              state.closed = true;
            },
            abort() {
              state.aborted = true;
            },
          }),
      };
    },
  );
  const text = () =>
    new TextDecoder("latin1").decode(
      new Uint8Array(chunks.flatMap((c) => Array.from(c))),
    );
  return { showSaveFilePicker, state, text };
}

const noSleep = () => Promise.resolve();

afterEach(() => vi.restoreAllMocks());

describe("requestTokens", () => {
  it("POSTs ids, variant and bulkId and returns the payload", async () => {
    const net = makeNet();
    const r = await requestTokens("boda", ["p0", "p1"], "web", "b1", {
      fetch: net.fetch,
    });
    expect(net.bodies[0]).toEqual({
      photoIds: ["p0", "p1"],
      variant: "web",
      bulkId: "b1",
    });
    expect(net.mock.mock.calls[0][0]).toBe("/api/g/boda/download-tokens");
    expect(r.tokens.map((t) => t.photoId)).toEqual(["p0", "p1"]);
  });

  it("throws EmailRequiredError on 403 email_required", async () => {
    const f = vi.fn(async () => json({ error: "email_required" }, 403));
    await expect(
      requestTokens("boda", ["p0"], "web", undefined, { fetch: f as never }),
    ).rejects.toBeInstanceOf(EmailRequiredError);
  });

  it("throws typed DownloadError for other failures", async () => {
    const mk = (res: () => Response | Promise<Response>) =>
      requestTokens("b", ["p0"], "web", undefined, {
        fetch: (async () => res()) as never,
      }).catch((e: unknown) => e);
    const a = (await mk(() =>
      json({ error: "variant_disabled" }, 403),
    )) as DownloadError;
    expect(a).toBeInstanceOf(DownloadError);
    expect(a.code).toBe("variant_disabled");
    expect(
      ((await mk(() => json({ error: "rate_limited" }, 429))) as DownloadError)
        .code,
    ).toBe("rate_limited");
    expect(((await mk(() => json({}, 500))) as DownloadError).code).toBe(
      "http",
    );
    expect(
      (
        (await mk(() => {
          throw new TypeError("offline");
        })) as DownloadError
      ).code,
    ).toBe("network");
  });
});

describe("downloadSingle", () => {
  it("clicks a temporary download anchor without navigating", async () => {
    const net = makeNet({ names: { p0: "IMG_0001.jpg" } });
    const seen: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      seen.push({
        href: this.getAttribute("href") ?? "",
        download: this.download,
      });
    });
    await downloadSingle("boda", "p0", "highres", { fetch: net.fetch });
    expect(seen).toEqual([{ href: "/dl/t-p0", download: "IMG_0001.jpg" }]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(net.bodies[0]).toEqual({ photoIds: ["p0"], variant: "highres" });
  });

  it("propagates EmailRequiredError", async () => {
    const f = vi.fn(async () => json({ error: "email_required" }, 403));
    await expect(
      downloadSingle("boda", "p0", "web", { fetch: f as never }),
    ).rejects.toBeInstanceOf(EmailRequiredError);
  });

  it("throws DownloadError(unavailable) when the size is missing", async () => {
    const f = vi.fn(async () =>
      json({ tokens: [], missing: [], unavailable: ["p0"] }),
    );
    await expect(
      downloadSingle("boda", "p0", "web", { fetch: f as never }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("downloadBulk", () => {
  it("batches 120 photos into 3 token calls, requested just in time", async () => {
    const net = makeNet({ n: 120 });
    const p = fakePicker();
    const r = await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      deps: {
        fetch: net.fetch,
        showSaveFilePicker: p.showSaveFilePicker,
        sleep: noSleep,
      },
    });
    expect(r.status).toBe("done");
    expect(net.log.filter((l) => l.startsWith("tokens"))).toEqual([
      "tokens:50",
      "tokens:50",
      "tokens:20",
    ]);
    expect(net.bodies[1]).toMatchObject({ bulkId: "b1", variant: "web" });
    const idx = (s: string) => net.log.indexOf(s);
    const tokenAt = net.log
      .map((l, i) => (l.startsWith("tokens") ? i : -1))
      .filter((i) => i >= 0);
    // batch 2 tokens come after the last file of batch 1 was fetched, before batch 2's first file
    expect(tokenAt[1]).toBeGreaterThan(idx("file:p49"));
    expect(tokenAt[1]).toBeLessThan(idx("file:p50"));
    expect(tokenAt[2]).toBeGreaterThan(idx("file:p99"));
    expect(tokenAt[2]).toBeLessThan(idx("file:p100"));
    expect(net.log[0]).toBe("bulk");
    expect(r.done).toBe(120);
  });

  it("never runs more than 3 file fetches at once", async () => {
    const net = makeNet({ n: 20 });
    const p = fakePicker();
    await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      deps: {
        fetch: net.fetch,
        showSaveFilePicker: p.showSaveFilePicker,
        sleep: noSleep,
      },
    });
    expect(net.maxInflight()).toBeLessThanOrEqual(3);
    expect(net.maxInflight()).toBeGreaterThan(1);
    expect(net.files()).toBe(20);
  });

  it("retries twice then succeeds", async () => {
    const net = makeNet({ failures: { p1: 2 } });
    const p = fakePicker();
    const r = await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      deps: {
        fetch: net.fetch,
        showSaveFilePicker: p.showSaveFilePicker,
        sleep: noSleep,
      },
    });
    expect(net.attempts.get("p1")).toBe(3);
    expect(r.failed).toEqual([]);
    expect(p.text()).toContain("p1.jpg");
  });

  it("skips a file that keeps failing, reports it, and still finishes the zip", async () => {
    const net = makeNet({ failures: { p1: 99 } });
    const p = fakePicker();
    const progress: { done: number; total: number; failed: string[] }[] = [];
    const r = await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      onProgress: (x) => progress.push({ ...x, failed: [...x.failed] }),
      deps: {
        fetch: net.fetch,
        showSaveFilePicker: p.showSaveFilePicker,
        sleep: noSleep,
      },
    });
    expect(net.attempts.get("p1")).toBe(3);
    expect(r.status).toBe("done");
    expect(r.failed).toEqual(["p1.jpg"]);
    expect(p.state.closed).toBe(true);
    const text = p.text();
    expect(text).toContain("p0.jpg");
    expect(text).toContain("p2.jpg");
    expect(text).not.toContain("p1.jpg");
    const last = progress[progress.length - 1];
    expect(last).toMatchObject({ done: 3, total: 3, failed: ["p1.jpg"] });
  });

  it("backs off exponentially between retries", async () => {
    const net = makeNet({ n: 1, failures: { p0: 2 } });
    const p = fakePicker();
    const sleep = vi.fn(async () => {});
    await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      deps: {
        fetch: net.fetch,
        showSaveFilePicker: p.showSaveFilePicker,
        sleep,
      },
    });
    const waits = sleep.mock.calls.map((c) => (c as unknown[])[0] as number);
    expect(waits).toHaveLength(2);
    expect(waits[1]).toBeGreaterThan(waits[0]);
  });

  it("reports progress with bytes", async () => {
    const net = makeNet();
    const p = fakePicker();
    const progress: { done: number; total: number; bytes: number }[] = [];
    await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      onProgress: (x) => progress.push({ ...x }),
      deps: {
        fetch: net.fetch,
        showSaveFilePicker: p.showSaveFilePicker,
        sleep: noSleep,
      },
    });
    const last = progress[progress.length - 1];
    expect(last.done).toBe(3);
    expect(last.total).toBe(3);
    expect(last.bytes).toBe("data-p0".length * 3);
  });

  it("abort stops further fetches and aborts the writable", async () => {
    const ctl = new AbortController();
    const net = makeNet({ n: 60, onFile: (_id, c) => c === 5 && ctl.abort() });
    const p = fakePicker();
    const r = await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      signal: ctl.signal,
      deps: {
        fetch: net.fetch,
        showSaveFilePicker: p.showSaveFilePicker,
        sleep: noSleep,
      },
    });
    expect(r.status).toBe("cancelled");
    expect(net.files()).toBeLessThan(15);
    expect(p.state.aborted).toBe(true);
    expect(p.state.closed).toBe(false);
  });

  it("abort in blob mode discards the result", async () => {
    const ctl = new AbortController();
    const net = makeNet({ n: 30, onFile: (_id, c) => c === 3 && ctl.abort() });
    const saveBlob = vi.fn();
    const r = await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      signal: ctl.signal,
      deps: { fetch: net.fetch, sleep: noSleep, saveBlob },
    });
    expect(r.status).toBe("cancelled");
    expect(saveBlob).not.toHaveBeenCalled();
    expect(net.files()).toBeLessThan(15);
  });

  it("dedupes file names", async () => {
    const net = makeNet({ names: { p0: "a.jpg", p1: "a.jpg", p2: "a.jpg" } });
    const p = fakePicker();
    await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      deps: {
        fetch: net.fetch,
        showSaveFilePicker: p.showSaveFilePicker,
        sleep: noSleep,
      },
    });
    const text = p.text();
    expect(text).toContain("a.jpg");
    expect(text).toContain("a (2).jpg");
    expect(text).toContain("a (3).jpg");
  });

  it("groups into set folders when scope is all and there are several sets", async () => {
    const net = makeNet({ names: { p0: "a.jpg", p1: "a.jpg", p2: "b.jpg" } });
    const p = fakePicker();
    await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      sets: new Map([
        ["p0", "Ceremonia"],
        ["p1", "Fiesta"],
        ["p2", "Fiesta"],
      ]),
      deps: {
        fetch: net.fetch,
        showSaveFilePicker: p.showSaveFilePicker,
        sleep: noSleep,
      },
    });
    const text = p.text();
    expect(text).toContain("Ceremonia/a.jpg");
    expect(text).toContain("Fiesta/a.jpg");
    expect(text).toContain("Fiesta/b.jpg");
    expect(text).not.toContain("a (2).jpg");
  });

  it("does not use folders for a set scope or a single set", async () => {
    const net = makeNet({ names: { p0: "a.jpg" } });
    const p = fakePicker();
    await downloadBulk({
      slug: "boda",
      scope: "set",
      set: "Fiesta",
      variant: "web",
      sets: new Map([["p0", "Fiesta"]]),
      deps: {
        fetch: net.fetch,
        showSaveFilePicker: p.showSaveFilePicker,
        sleep: noSleep,
      },
    });
    expect(p.text()).not.toContain("Fiesta/");
    expect(net.bodies[0]).toEqual({
      scope: "set",
      set: "Fiesta",
      variant: "web",
    });
  });

  it("names the zip <slug>[-<set>]-<variant>.zip", async () => {
    const p = fakePicker();
    const a = makeNet();
    await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "highres",
      deps: {
        fetch: a.fetch,
        showSaveFilePicker: p.showSaveFilePicker,
        sleep: noSleep,
      },
    });
    expect(p.state.name).toBe("boda-highres.zip");
    const b = makeNet();
    await downloadBulk({
      slug: "boda",
      scope: "set",
      set: "Fiesta",
      variant: "ig",
      deps: {
        fetch: b.fetch,
        showSaveFilePicker: p.showSaveFilePicker,
        sleep: noSleep,
      },
    });
    expect(p.state.name).toBe("boda-Fiesta-ig.zip");
  });

  it("streams into the picker file when showSaveFilePicker exists", async () => {
    const net = makeNet();
    const p = fakePicker();
    const saveBlob = vi.fn();
    const r = await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      deps: {
        fetch: net.fetch,
        showSaveFilePicker: p.showSaveFilePicker,
        saveBlob,
        sleep: noSleep,
      },
    });
    expect(r.sink).toBe("picker");
    expect(p.showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(saveBlob).not.toHaveBeenCalled();
    expect(p.state.closed).toBe(true);
  });

  it("falls back to a Blob download without the picker", async () => {
    const net = makeNet();
    const saveBlob = vi.fn();
    const r = await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      deps: { fetch: net.fetch, saveBlob, sleep: noSleep },
    });
    expect(r.sink).toBe("blob");
    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe("boda-web.zip");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("reports cancelled when the user dismisses the file picker", async () => {
    const net = makeNet();
    const r = await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      deps: {
        fetch: net.fetch,
        sleep: noSleep,
        showSaveFilePicker: async () => {
          throw new DOMException("x", "AbortError");
        },
      },
    });
    expect(r.status).toBe("cancelled");
    expect(net.files()).toBe(0);
  });

  it("throws EmailRequiredError when /bulk needs an email", async () => {
    const net = makeNet({ bulk: json({ error: "email_required" }, 403) });
    await expect(
      downloadBulk({
        slug: "boda",
        scope: "all",
        variant: "web",
        deps: { fetch: net.fetch, sleep: noSleep },
      }),
    ).rejects.toBeInstanceOf(EmailRequiredError);
  });

  it("finishes immediately when the scope is empty", async () => {
    const net = makeNet({ bulk: json({ bulkId: null, photoIds: [] }) });
    const saveBlob = vi.fn();
    const r = await downloadBulk({
      slug: "boda",
      scope: "all",
      variant: "web",
      deps: { fetch: net.fetch, saveBlob, sleep: noSleep },
    });
    expect(r).toMatchObject({ status: "done", done: 0, total: 0 });
    expect(saveBlob).not.toHaveBeenCalled();
  });
});

describe("bulkWarning", () => {
  const MB = 1024 * 1024;
  it("flags large blob downloads using totalBytes when present", () => {
    expect(
      bulkWarning({
        count: 10,
        variant: "highres",
        totalBytes: 2000 * MB,
        picker: false,
      }),
    ).toBe("large");
    expect(
      bulkWarning({
        count: 5000,
        variant: "highres",
        totalBytes: 100 * MB,
        picker: false,
      }),
    ).toBeNull();
  });
  it("estimates by variant when totalBytes is unknown", () => {
    expect(
      bulkWarning({ count: 1000, variant: "web", picker: false }),
    ).toBeNull(); // ~1.2 GB
    expect(bulkWarning({ count: 1400, variant: "web", picker: false })).toBe(
      "large",
    ); // ~1.7 GB
    expect(bulkWarning({ count: 600, variant: "highres", picker: false })).toBe(
      "large",
    ); // ~1.8 GB
    expect(
      bulkWarning({ count: 2000, variant: "ig", picker: false }),
    ).toBeNull(); // ~1.2 GB
    expect(bulkWarning({ count: 3000, variant: "ig", picker: false })).toBe(
      "large",
    );
  });
  it("never warns when streaming to a file", () => {
    expect(
      bulkWarning({ count: 5000, variant: "highres", picker: true }),
    ).toBeNull();
  });
  it("warns on iOS regardless of size", () => {
    expect(
      bulkWarning({
        count: 3,
        variant: "web",
        picker: false,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      }),
    ).toBe("ios");
    expect(
      bulkWarning({
        count: 3,
        variant: "web",
        picker: false,
        userAgent: "Mozilla/5.0 (iPad; CPU OS 17)",
      }),
    ).toBe("ios");
    expect(
      bulkWarning({
        count: 3,
        variant: "web",
        picker: false,
        userAgent: "Mozilla/5.0 (X11; Linux)",
      }),
    ).toBeNull();
  });
});
