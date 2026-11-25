import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFavorites } from "../../app/components/use-favorites";
import { useVisitor } from "../../app/components/use-visitor";

// T6.51 characterization of the favourites / visitor hooks, written to fail
// when a condition in them is flipped (optimistic toggle, rollback guard,
// in-flight-load merge, email gate, offline mode).
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let get: () => Promise<Response>;
let post: (body: { photoId: string; on: boolean }) => Promise<Response>;

beforeEach(() => {
  calls = [];
  get = async () => json({ visitor: null, favorites: [] });
  post = async () => json({ ok: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: String(input), method, body });
      if (String(input).endsWith("/visitor")) return json({ ok: true });
      return method === "GET" ? get() : post(body);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("T6.51 useFavorites (characterization)", () => {
  it("a toggle made while the initial load is in flight wins over the load reply", async () => {
    const load = deferred<Response>();
    get = () => load.promise;
    const { result } = renderHook(() => useFavorites("boda", false));
    await act(async () => {
      await result.current.toggle("p9"); // not in the reply: stays on
    });
    await act(async () => {
      await result.current.toggle("p1"); // on...
    });
    await act(async () => {
      await result.current.toggle("p1"); // ...and off again: stays off
    });
    expect([...result.current.ids]).toEqual(["p9"]);
    await act(async () => {
      load.resolve(json({ visitor: null, favorites: ["p1", "p2"] }));
    });
    await waitFor(() => expect(result.current.ids.has("p2")).toBe(true));
    expect(result.current.ids.has("p9")).toBe(true);
    expect(result.current.ids.has("p1")).toBe(false);
  });

  it("a rollback does not undo a toggle made again in the meantime", async () => {
    const first = deferred<Response>();
    let n = 0;
    post = () =>
      n++ === 0 ? first.promise : Promise.resolve(json({ ok: true }));
    const { result } = renderHook(() => useFavorites("boda", false));
    await waitFor(() => expect(calls.length).toBe(1));
    let p1!: Promise<void>;
    act(() => {
      p1 = result.current.toggle("p1"); // on, answer pending
    });
    await act(async () => {
      await result.current.toggle("p1"); // off (second POST succeeds)
    });
    expect(result.current.ids.has("p1")).toBe(false);
    await act(async () => {
      first.resolve(json({ error: "x" }, 500)); // first POST fails late
      await p1;
    });
    // The failed "on" must not re-add or flip the newer "off".
    expect(result.current.ids.has("p1")).toBe(false);
  });

  it("a failed POST rolls the toggle back and reports through onError once", async () => {
    post = async () => json({ error: "x" }, 500);
    const onError = vi.fn();
    const { result } = renderHook(() => useFavorites("boda", false, onError));
    await waitFor(() => expect(calls.length).toBe(1));
    await act(async () => {
      await result.current.toggle("p1");
    });
    expect(result.current.ids.has("p1")).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("a 403 that is not email_required is a failure, not a gate", async () => {
    post = async () => json({ error: "forbidden" }, 403);
    const onError = vi.fn();
    const { result } = renderHook(() => useFavorites("boda", false, onError));
    await waitFor(() => expect(calls.length).toBe(1));
    await act(async () => {
      await result.current.toggle("p1");
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.gateOpen).toBe(false);
    expect(result.current.ids.has("p1")).toBe(false);
  });

  it("a 403 email_required rolls back, opens the gate and does not flash an error", async () => {
    post = async () => json({ error: "email_required" }, 403);
    const onError = vi.fn();
    const { result } = renderHook(() => useFavorites("boda", false, onError));
    await waitFor(() => expect(calls.length).toBe(1));
    await act(async () => {
      await result.current.toggle("p1");
    });
    expect(result.current.gateOpen).toBe(true);
    expect(result.current.ids.has("p1")).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("requireEmail without a known visitor parks the toggle: no POST until the gate is submitted", async () => {
    const { result } = renderHook(() => useFavorites("boda", true));
    await waitFor(() => expect(calls.length).toBe(1));
    await act(async () => {
      await result.current.toggle("p1");
    });
    expect(result.current.gateOpen).toBe(true);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await act(async () => {
      await result.current.submitGate("a@b.co", "Ana");
    });
    expect(result.current.gateOpen).toBe(false);
    expect(result.current.visitor).toEqual({ email: "a@b.co", name: "Ana" });
    expect(calls.find((c) => c.url.endsWith("/visitor"))?.body).toEqual({
      email: "a@b.co",
      name: "Ana",
    });
    expect(calls.filter((c) => c.method === "POST" && c.body)).toContainEqual(
      expect.objectContaining({ body: { photoId: "p1", on: true } }),
    );
    expect(result.current.ids.has("p1")).toBe(true);
  });

  it("a known visitor from the load skips the gate", async () => {
    get = async () =>
      json({ visitor: { email: "a@b.co", name: null }, favorites: [] });
    const { result } = renderHook(() => useFavorites("boda", true));
    await waitFor(() => expect(result.current.visitor?.email).toBe("a@b.co"));
    await act(async () => {
      await result.current.toggle("p1");
    });
    expect(result.current.gateOpen).toBe(false);
    expect(result.current.ids.has("p1")).toBe(true);
  });

  it("an anonymous server visitor (null) is not a known email", async () => {
    const { result } = renderHook(() => useFavorites("boda", true));
    await waitFor(() => expect(calls.length).toBe(1));
    await act(async () => {
      await result.current.toggle("p1");
    });
    expect(result.current.gateOpen).toBe(true);
  });

  it("closeGate drops the parked action", async () => {
    const { result } = renderHook(() => useFavorites("boda", true));
    await waitFor(() => expect(calls.length).toBe(1));
    await act(async () => {
      await result.current.toggle("p1");
    });
    act(() => result.current.closeGate());
    expect(result.current.gateOpen).toBe(false);
    await act(async () => {
      await result.current.submitGate("a@b.co", "");
    });
    expect(
      calls.filter(
        (c) => c.method === "POST" && c.body && "photoId" in (c.body as object),
      ),
    ).toHaveLength(0);
  });

  it("submitGate reports invalid (400) and error (5xx) and keeps the gate open", async () => {
    const { result } = renderHook(() => useFavorites("boda", true));
    await waitFor(() => expect(calls.length).toBe(1));
    await act(async () => {
      await result.current.toggle("p1");
    });
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(json({}, 400));
    let r: unknown;
    await act(async () => {
      r = await result.current.submitGate("bad", "");
    });
    expect(r).toBe("invalid");
    f.mockResolvedValueOnce(json({}, 500));
    await act(async () => {
      r = await result.current.submitGate("a@b.co", "");
    });
    expect(r).toBe("error");
    f.mockRejectedValueOnce(new Error("net"));
    await act(async () => {
      r = await result.current.submitGate("a@b.co", "");
    });
    expect(r).toBe("error");
    expect(result.current.gateOpen).toBe(true);
    expect(result.current.visitor).toBeNull();
  });

  it("offline: toggles in memory, never calls the API", async () => {
    const { result } = renderHook(() =>
      useFavorites("boda", true, undefined, true),
    );
    await act(async () => {
      await result.current.toggle("p1");
    });
    expect(result.current.ids.has("p1")).toBe(true);
    await act(async () => {
      await result.current.toggle("p1");
    });
    expect(result.current.ids.has("p1")).toBe(false);
    expect(result.current.gateOpen).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("encodes the slug in the API path", async () => {
    renderHook(() => useFavorites("a b/c", false));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].url).toBe("/api/g/a%20b%2Fc/favorites");
  });

  it("a failed or non-ok load leaves the favourites empty without throwing", async () => {
    get = async () => json({}, 500);
    const { result } = renderHook(() => useFavorites("boda", false));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(result.current.ids.size).toBe(0);
    expect(result.current.visitor).toBeNull();
  });
});

describe("T6.51 useFavorites (mutant guards)", () => {
  it("a saved favourite marks the visitor known: a later email requirement does not gate", async () => {
    const { result, rerender } = renderHook(
      ({ req }) => useFavorites("boda", req),
      { initialProps: { req: false } },
    );
    await waitFor(() => expect(calls.length).toBe(1));
    await act(async () => {
      await result.current.toggle("p1"); // POST ok -> markKnown
    });
    rerender({ req: true });
    await act(async () => {
      await result.current.toggle("p2");
    });
    expect(result.current.gateOpen).toBe(false);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });

  it("toggling after the gallery changed posts to the new gallery", async () => {
    const { result, rerender } = renderHook(
      ({ slug }) => useFavorites(slug, false),
      { initialProps: { slug: "uno" } },
    );
    await waitFor(() => expect(calls.length).toBe(1));
    rerender({ slug: "dos" });
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].url).toBe("/api/g/dos/favorites");
    await act(async () => {
      await result.current.toggle("p1");
    });
    expect(calls.at(-1)).toMatchObject({
      url: "/api/g/dos/favorites",
      method: "POST",
    });
  });

  it("leaving offline mode loads the favourites from the server", async () => {
    const { rerender } = renderHook(
      ({ offline }) => useFavorites("boda", false, undefined, offline),
      { initialProps: { offline: true } },
    );
    expect(calls).toHaveLength(0);
    rerender({ offline: false });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: "GET" });
  });

  it.each([404, 429, 500])(
    "a %i is a plain failure even if its body says email_required",
    async (status) => {
      post = async () => json({ error: "email_required" }, status);
      const onError = vi.fn();
      const { result } = renderHook(() => useFavorites("boda", false, onError));
      await waitFor(() => expect(calls.length).toBe(1));
      await act(async () => {
        await result.current.toggle("p1");
      });
      expect(result.current.gateOpen).toBe(false);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(result.current.ids.has("p1")).toBe(false);
    },
  );
});

describe("T6.51 useVisitor (characterization)", () => {
  it("ensure runs the action at once when no email is required", async () => {
    const { result } = renderHook(() => useVisitor("boda", false));
    const action = vi.fn();
    await act(async () => {
      await result.current.ensure(action);
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.gateOpen).toBe(false);
  });

  it("ensure parks the action behind the gate and runs it after a successful submit", async () => {
    const { result } = renderHook(() => useVisitor("boda", true));
    const action = vi.fn();
    await act(async () => {
      await result.current.ensure(action);
    });
    expect(action).not.toHaveBeenCalled();
    expect(result.current.gateOpen).toBe(true);
    await act(async () => {
      await result.current.submitGate("a@b.co", "");
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.visitor).toEqual({ email: "a@b.co", name: null });
    expect(calls[0].body).toEqual({ email: "a@b.co" });
  });

  it("an action that throws a non-email error propagates it", async () => {
    const { result } = renderHook(() => useVisitor("boda", false));
    await expect(
      act(async () => {
        await result.current.ensure(() => {
          throw new Error("boom");
        });
      }),
    ).rejects.toThrow("boom");
    expect(result.current.gateOpen).toBe(false);
  });

  it("markKnown lets later actions through the gate", async () => {
    const { result } = renderHook(() => useVisitor("boda", true));
    act(() => result.current.markKnown());
    const action = vi.fn();
    await act(async () => {
      await result.current.ensure(action);
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.gateOpen).toBe(false);
  });
});
