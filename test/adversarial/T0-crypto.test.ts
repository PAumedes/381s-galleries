import { describe, expect, it } from "vitest";
import {
  b64urlDecode,
  b64urlEncode,
  hashIp,
  signToken,
  verifyToken,
} from "../../app/lib/server/crypto";

describe("T0 adversarial: crypto", () => {
  it("token signature is not malleable (non-canonical base64url trailing bits)", async () => {
    const secret = "a-long-random-secret-for-tests-0123456789";
    const t = await signToken({ a: 1 }, secret, 60);
    const [body, sig] = t.split(".");
    // 32-byte MAC => 43 chars; the last char carries 4 unused bits.
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = sig[sig.length - 1];
    const idx = alphabet.indexOf(last);
    const variant = alphabet[idx ^ 1]; // differs only in unused low bits
    const forged = `${body}.${sig.slice(0, -1)}${variant}`;
    expect(forged).not.toBe(t);
    expect(await verifyToken(forged, secret)).toBeNull();
  });

  it("b64urlDecode rejects non-canonical encodings", () => {
    // "QQ" is canonical for 0x41; "QR" has non-zero trailing bits.
    expect(() => b64urlDecode("QR")).toThrow();
    expect(b64urlEncode(b64urlDecode("QQ"))).toBe("QQ");
  });

  it("hashIp is domain-separated from token signatures", async () => {
    const secret = "a-long-random-secret-for-tests-0123456789";
    const t = await signToken({ a: 1 }, secret, 60);
    const [body, sig] = t.split(".");
    const macPrefixHex = Array.from(b64urlDecode(sig).slice(0, 8), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    // hashIp(x) must not reveal the first 8 bytes of the HMAC token signature of x.
    expect(await hashIp(body, secret)).not.toBe(macPrefixHex);
  });

  it("refuses placeholder / weak secrets instead of signing", async () => {
    // .dev.vars.example ships SESSION_SECRET=change-me
    await expect(signToken({ a: 1 }, "change-me", 60)).rejects.toThrow();
    await expect(signToken({ a: 1 }, "", 60)).rejects.toThrow();
  });
});
