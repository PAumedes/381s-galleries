import { describe, expect, it } from "vitest";
import { createDriveClient } from "../../app/lib/server/drive";

describe("T1.2r2 streamFile 401", () => {
  it("refreshes the token once on 401 and retries", async () => {
    const seen: string[] = [];
    const fetchFn = (async (_u: unknown, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization")!;
      seen.push(auth);
      if (auth === "Bearer stale") return new Response("{}", { status: 401 });
      return new Response("bytes", { status: 200 });
    }) as unknown as typeof fetch;
    const client = createDriveClient(
      async (force) => (force ? "fresh" : "stale"),
      {
        fetch: fetchFn,
        sleep: async () => {},
      },
    );
    const res = await client.streamFile("abc");
    expect(await res.text()).toBe("bytes");
    expect(seen).toEqual(["Bearer stale", "Bearer fresh"]);
  });
});
