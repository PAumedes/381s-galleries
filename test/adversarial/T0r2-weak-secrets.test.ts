import { describe, expect, it } from "vitest";
import { encryptSecret, signToken } from "../../app/lib/server/crypto";

describe("T0r2 adversarial: weak secret guard", () => {
  it("rejects trivially low-entropy HMAC secrets (32 identical chars)", async () => {
    await expect(signToken({ a: 1 }, "a".repeat(32), 60)).rejects.toThrow();
  });
  it("rejects whitespace-only HMAC secret", async () => {
    await expect(signToken({ a: 1 }, " ".repeat(32), 60)).rejects.toThrow();
  });
  it("rejects an all-zero AES TOKEN_KEY", async () => {
    await expect(
      encryptSecret("refresh-token", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
    ).rejects.toThrow();
  });
});
