import { describe, expect, it, vi, afterEach } from "vitest";
import {
  b64urlDecode,
  b64urlEncode,
  decryptSecret,
  encryptSecret,
  hashIp,
  hashPin,
  newId,
  signToken,
  verifyToken,
  verifyPin,
} from "../app/lib/server/crypto";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

afterEach(() => vi.useRealTimers());

describe("helpers", () => {
  it("newId is unique uuid", () => {
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(newId()).not.toBe(newId());
  });
  it("base64url roundtrip", () => {
    const bytes = new Uint8Array([251, 255, 254, 0, 1]);
    const s = b64urlEncode(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(Array.from(b64urlDecode(s))).toEqual(Array.from(bytes));
  });
});

describe("tokens", () => {
  it("roundtrips", async () => {
    const t = await signToken({ a: 1 }, "s", 60);
    expect(await verifyToken<{ a: number }>(t, "s")).toMatchObject({ a: 1 });
  });
  it("rejects tampered payload", async () => {
    const t = await signToken({ a: 1 }, "s", 60);
    const [, sig] = t.split(".");
    const forged = `${b64urlEncode(JSON.stringify({ a: 2, exp: 9999999999 }))}.${sig}`;
    expect(await verifyToken(forged, "s")).toBeNull();
  });
  it("rejects tampered signature", async () => {
    const t = await signToken({ a: 1 }, "s", 60);
    const [body, sig] = t.split(".");
    const bad = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(await verifyToken(`${body}.${bad}`, "s")).toBeNull();
  });
  it("rejects bad format", async () => {
    expect(await verifyToken("nope", "s")).toBeNull();
    expect(await verifyToken("a.b.c", "s")).toBeNull();
    expect(await verifyToken("!!.??", "s")).toBeNull();
  });
  it("rejects expired", async () => {
    const t = await signToken({ a: 1 }, "s", -1);
    expect(await verifyToken(t, "s")).toBeNull();
    vi.useFakeTimers();
    const t2 = await signToken({ a: 1 }, "s", 10);
    vi.advanceTimersByTime(11_000);
    expect(await verifyToken(t2, "s")).toBeNull();
  });
  it("rejects wrong secret", async () => {
    const t = await signToken({ a: 1 }, "s", 60);
    expect(await verifyToken(t, "other")).toBeNull();
  });
});

describe("pin", () => {
  it("verifies correct and rejects incorrect", async () => {
    const h = await hashPin("1234");
    expect(h).toMatch(/^pbkdf2\$100000\$[\w-]+\$[\w-]+$/);
    expect(await verifyPin("1234", h)).toBe(true);
    expect(await verifyPin("1235", h)).toBe(false);
    expect(await verifyPin("1234", "garbage")).toBe(false);
  });
  it("salts differ", async () => {
    expect(await hashPin("1234")).not.toBe(await hashPin("1234"));
  });
});

describe("encryptSecret", () => {
  it("roundtrips", async () => {
    const c = await encryptSecret("refresh-token", KEY);
    expect(c).not.toContain("refresh-token");
    expect(await decryptSecret(c, KEY)).toBe("refresh-token");
  });
  it("fails on tampered ciphertext", async () => {
    const c = await encryptSecret("refresh-token", KEY);
    const [iv, ct] = c.split(".");
    const bytes = b64urlDecode(ct);
    bytes[0] ^= 1;
    await expect(
      decryptSecret(`${iv}.${b64urlEncode(bytes)}`, KEY),
    ).rejects.toThrow();
    await expect(decryptSecret("junk", KEY)).rejects.toThrow();
  });
});

describe("hashIp", () => {
  it("is short, stable, keyed", async () => {
    const a = await hashIp("1.2.3.4", "s");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await hashIp("1.2.3.4", "s")).toBe(a);
    expect(await hashIp("1.2.3.4", "t")).not.toBe(a);
  });
});
