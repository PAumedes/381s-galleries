import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApprovals } from "../../app/components/use-approvals";
import { EmailRequiredError } from "../../app/components/use-visitor";
import type { GalleryPhoto } from "../../app/components/types";

// T6.53f: the visitor's approvals. Optimistic toggle, a real revert on
// failure, a new version re-opens (approval is keyed by the SHOWN version).
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let post: (body: unknown) => Promise<Response>;

beforeEach(() => {
  calls = [];
  post = async () => json({ ok: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return post(calls.at(-1)!.body);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const photo = (over: Partial<GalleryPhoto> = {}): GalleryPhoto => ({
  id: "A",
  width: 3,
  height: 2,
  set: "S",
  variants: { web: true, ig: true },
  ...over,
});
const run = <T,>(fn: () => Promise<T>) => fn();
const ensure = (action: () => void | Promise<void>) =>
  run(async () => action());

function setup(
  over: Partial<Parameters<typeof useApprovals>[0]> = {},
  onError = vi.fn(),
) {
  const hook = renderHook(
    (props: { loaded: { id: string; ver: number }[] | null }) =>
      useApprovals({
        slug: "boda",
        enabled: true,
        offline: false,
        ensure,
        loaded: props.loaded,
        onError,
        ...over,
      }),
    { initialProps: { loaded: [] as { id: string; ver: number }[] | null } },
  );
  return { ...hook, onError };
}

describe("T6.53f useApprovals", () => {
  it("is off (and never calls the server) when the album has no approvals", async () => {
    const { result } = setup({ enabled: false });
    expect(result.current.enabled).toBe(false);
    expect(result.current.approvedAt(photo())).toBeNull();
    await act(async () => result.current.toggle(photo()));
    expect(calls).toEqual([]);
  });

  it("knows the server's list, keyed by the shown version (ver, or 1 without history)", () => {
    const r = renderHook(() =>
      useApprovals({
        slug: "boda",
        enabled: true,
        offline: false,
        ensure,
        loaded: [
          { id: "A", ver: 2 },
          { id: "B", ver: 1 },
        ],
        onError: () => {},
      }),
    );
    expect(r.result.current.approvedAt(photo({ id: "A", ver: 2 }))).toBe(2);
    // a NEW version (v3) of A is not approved: the old approval of v2 does not carry over
    expect(r.result.current.approvedAt(photo({ id: "A", ver: 3 }))).toBeNull();
    expect(r.result.current.approvedAt(photo({ id: "B" }))).toBe(1);
    expect(r.result.current.approvedAt(photo({ id: "C" }))).toBeNull();
    expect(r.result.current.enabled).toBe(true);
  });

  it("approves optimistically, POSTs the shown version, and keeps it on success", async () => {
    const { result } = setup();
    const p = photo({ ver: 3 });
    await act(async () => result.current.toggle(p));
    expect(calls).toEqual([
      {
        url: "/api/g/boda/approvals",
        method: "POST",
        body: { photoId: "A", version: 3, on: true },
      },
    ]);
    expect(result.current.approvedAt(p)).toBe(3);
    await act(async () => result.current.toggle(p));
    expect(calls[1].body).toEqual({ photoId: "A", version: 3, on: false });
    expect(result.current.approvedAt(p)).toBeNull();
  });

  it("shows the approval at once, before the server answers", async () => {
    let release!: (r: Response) => void;
    post = () => new Promise<Response>((r) => (release = r));
    const { result } = setup();
    const p = photo();
    let done!: Promise<void>;
    act(() => {
      done = Promise.resolve(result.current.toggle(p));
    });
    await waitFor(() => expect(result.current.approvedAt(p)).toBe(1));
    await act(async () => {
      release(json({ ok: true }));
      await done;
    });
    expect(result.current.approvedAt(p)).toBe(1);
  });

  it.each([
    ["a server error", () => json({ error: "x" }, 500), "approvals.error"],
    ["a stale version", () => json({ error: "stale" }, 409), "approvals.stale"],
    ["the limit", () => json({ error: "limit" }, 409), "approvals.error"],
    [
      "a network failure",
      () => Promise.reject(new TypeError("offline")),
      "approvals.error",
    ],
  ])("really reverts on %s and tells the visitor", async (_n, answer, key) => {
    post = async () => answer();
    const { result, onError } = setup();
    const p = photo();
    await act(async () => result.current.toggle(p));
    expect(result.current.approvedAt(p)).toBeNull();
    expect(onError).toHaveBeenCalledWith(key);
  });

  it("a failed un-approve puts the approval back", async () => {
    const { result } = setup();
    const p = photo();
    await act(async () => result.current.toggle(p));
    post = async () => json({ error: "x" }, 500);
    await act(async () => result.current.toggle(p));
    expect(result.current.approvedAt(p)).toBe(1);
  });

  it("a revert does not undo a toggle made again in the meantime", async () => {
    const first = Promise.withResolvers<Response>();
    let n = 0;
    post = () =>
      n++ === 0 ? first.promise : Promise.resolve(json({ ok: true }));
    const { result } = setup();
    const p = photo();
    let p1!: Promise<void>;
    act(() => {
      p1 = Promise.resolve(result.current.toggle(p)); // on, answer pending
    });
    await waitFor(() => expect(calls.length).toBe(1));
    await act(async () => result.current.toggle(p)); // off
    expect(result.current.approvedAt(p)).toBeNull();
    await act(async () => {
      first.resolve(json({ error: "x" }, 500)); // the first one fails late
      await p1;
    });
    expect(result.current.approvedAt(p)).toBeNull(); // stays off, not re-flipped
  });

  it("email_required reverts and re-opens the gate (EmailRequiredError)", async () => {
    post = async () => json({ error: "email_required" }, 403);
    const seen: unknown[] = [];
    const { result, onError } = setup({
      ensure: async (a) => {
        try {
          await a();
        } catch (e) {
          seen.push(e);
        }
      },
    });
    const p = photo();
    await act(async () => result.current.toggle(p));
    expect(seen[0]).toBeInstanceOf(EmailRequiredError);
    expect(result.current.approvedAt(p)).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("offline (admin preview) keeps approvals in memory and never fetches", async () => {
    const { result } = setup({ offline: true });
    const p = photo({ ver: 2 });
    await act(async () => result.current.toggle(p));
    expect(result.current.approvedAt(p)).toBe(2);
    expect(calls).toEqual([]);
  });
});
