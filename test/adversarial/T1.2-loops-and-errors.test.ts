import { describe, expect, it } from "vitest";
import { createDriveClient } from "../../app/lib/server/drive";
import { DriveError } from "../../app/lib/server/drive-types";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "content-type": "application/json" },
  });

function mk(handler: (n: number, url: URL) => Response | Promise<Response>) {
  let n = 0;
  const fetchFn = (async (i: RequestInfo | URL) => {
    n++;
    if (n > 200) throw new Error("RUNAWAY: >200 subrequests");
    return handler(n, new URL(String(i)));
  }) as unknown as typeof fetch;
  const client = createDriveClient(async () => "tok", {
    fetch: fetchFn,
    sleep: async () => {},
  });
  return { client, count: () => n };
}

describe("T1.2 adversarial", () => {
  it("listChildren stops on a repeating nextPageToken (Worker subrequest cap ~50)", async () => {
    const { client, count } = mk(() =>
      json({ nextPageToken: "same", files: [] }),
    );
    await expect(client.listChildren("F")).rejects.toBeInstanceOf(DriveError);
    expect(count()).toBeLessThan(50);
  });

  it("listChanges stops on a repeating nextPageToken", async () => {
    const { client, count } = mk(() =>
      json({ nextPageToken: "same", changes: [] }),
    );
    await expect(client.listChanges("T")).rejects.toBeInstanceOf(DriveError);
    expect(count()).toBeLessThan(50);
  });

  it("200 with non-JSON body surfaces a DriveError, not a raw SyntaxError", async () => {
    const { client } = mk(
      () => new Response("<html>captive portal</html>", { status: 200 }),
    );
    await expect(client.getMeta("x")).rejects.toBeInstanceOf(DriveError);
  });

  it("transient network failure is retried", async () => {
    const { client } = mk((n) => {
      if (n === 1) throw new TypeError("network lost");
      return json({
        id: "x",
        name: "a",
        mimeType: "image/jpeg",
        modifiedTime: "2024-01-01T00:00:00Z",
      });
    });
    await expect(client.getMeta("x")).resolves.toMatchObject({ id: "x" });
  });

  it("empty-string size is not mapped to 0 bytes", async () => {
    const { client } = mk(() =>
      json({
        id: "x",
        name: "a",
        mimeType: "image/jpeg",
        modifiedTime: "2024-01-01T00:00:00Z",
        size: "",
      }),
    );
    expect((await client.getMeta("x")).size).toBeUndefined();
  });
});
