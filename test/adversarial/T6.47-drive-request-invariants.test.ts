import { describe, expect, it } from "vitest";
import { createDriveClient } from "../../app/lib/server/drive";
import { DriveError } from "../../app/lib/server/drive-types";

const TOKEN = "ya29.SECRET-ACCESS-TOKEN";

function client(handler: (n: number) => Response) {
  let n = 0;
  const sleeps: number[] = [];
  const c = createDriveClient(async () => TOKEN, {
    fetch: (async () => handler(n++)) as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { c, sleeps };
}

describe("T6.47 drive-request invariants (survived mutation)", () => {
  it("never puts the access token in a DriveError detail", async () => {
    const { c } = client(
      () =>
        new Response(
          JSON.stringify({
            error: { message: `Invalid Credentials for Bearer ${TOKEN} sorry` },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    );
    const err = (await c.listChildren("f").catch((e) => e)) as DriveError;
    expect(err).toBeInstanceOf(DriveError);
    expect(JSON.stringify([err.message, err.detail])).not.toContain(TOKEN);
  });

  it("caps an attacker/Drive-supplied Retry-After at 30s", async () => {
    const { c, sleeps } = client((n) =>
      n === 0
        ? new Response("{}", {
            status: 429,
            headers: { "retry-after": "86400" },
          })
        : new Response(JSON.stringify({ files: [] }), {
            headers: { "content-type": "application/json" },
          }),
    );
    await c.listChildren("f");
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeLessThanOrEqual(30_000);
  });
});
