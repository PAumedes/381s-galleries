import { describe, expect, it } from "vitest";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { handleSync } from "../../app/routes/api.admin.sync";
import { e, setup } from "./T1.3-helpers";

setup();

describe("T1.3 admin sync route", () => {
  it("cross-site POST (Access cookie auth) must not trigger a forced sync", async () => {
    const r = await handleSync(
      new Request("http://localhost/api/admin/sync", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Sec-Fetch-Site": "cross-site",
        },
      }),
      e,
      createMockDrive(),
    );
    expect(r.status).toBe(403);
  });
});
