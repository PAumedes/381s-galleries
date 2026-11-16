import { describe, expect, it } from "vitest";
import { pinFingerprint } from "../../app/lib/server/auth";

const env = { SESSION_SECRET: "k".repeat(16) + "abcdefghijklmnop0123456789" };

describe("P1 review: pin fingerprint sentinel", () => {
  it("a literal pin_hash 'none' must not share the fingerprint of 'no PIN'", async () => {
    expect(await pinFingerprint("none", env)).not.toBe(
      await pinFingerprint(null, env),
    );
  });
});
