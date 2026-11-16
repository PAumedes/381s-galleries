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

const S = "test-secret-0123456789-abcdefghijklmnop";
const KEY = "yogTK+cwJid8noG4Vt0xD2UnRFi5DXpIYNqlDl+l0HE=";

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
    const t = await signToken({ a: 1 }, S, 60);
    expect(await verifyToken<{ a: number }>(t, S)).toMatchObject({ a: 1 });
  });
  it("rejects tampered payload", async () => {
    const t = await signToken({ a: 1 }, S, 60);
    const [, sig] = t.split(".");
    const forged = `${b64urlEncode(JSON.stringify({ a: 2, exp: 9999999999 }))}.${sig}`;
    expect(await verifyToken(forged, S)).toBeNull();
  });
  it("rejects tampered signature", async () => {
    const t = await signToken({ a: 1 }, S, 60);
    const [body, sig] = t.split(".");
    const bad = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(await verifyToken(`${body}.${bad}`, S)).toBeNull();
  });
  it("rejects bad format", async () => {
    expect(await verifyToken("nope", S)).toBeNull();
    expect(await verifyToken("a.b.c", S)).toBeNull();
    expect(await verifyToken("!!.??", S)).toBeNull();
  });
  it("rejects expired", async () => {
    const t = await signToken({ a: 1 }, S, -1);
    expect(await verifyToken(t, S)).toBeNull();
    vi.useFakeTimers();
    const t2 = await signToken({ a: 1 }, S, 10);
    vi.advanceTimersByTime(11_000);
    expect(await verifyToken(t2, S)).toBeNull();
  });
  it("rejects a flipped last signature character", async () => {
    const t = await signToken({ a: 1 }, S, 60);
    const [body, sig] = t.split(".");
    const last = sig[sig.length - 1];
    // "A" and "g" differ in the used high bits as well as the unused ones.
    const bad = sig.slice(0, -1) + (last === "A" ? "g" : "A");
    expect(await verifyToken(`${body}.${bad}`, S)).toBeNull();
  });
  it("rejects exp == now (boundary) and accepts exp == now + 1", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const t = await signToken({ a: 1 }, S, 10);
    vi.setSystemTime(new Date("2030-01-01T00:00:09Z"));
    expect(await verifyToken(t, S)).not.toBeNull();
    vi.setSystemTime(new Date("2030-01-01T00:00:10Z"));
    expect(await verifyToken(t, S)).toBeNull();
  });
  it("throws on weak secrets in verifyToken and hashIp", async () => {
    const t = await signToken({ a: 1 }, S, 60);
    await expect(verifyToken(t, "short")).rejects.toThrow();
    await expect(verifyToken(t, "change-me")).rejects.toThrow();
    await expect(hashIp("1.2.3.4", "change-me")).rejects.toThrow();
  });
  it("rejects wrong secret", async () => {
    const t = await signToken({ a: 1 }, S, 60);
    expect(
      await verifyToken(t, "other-secret-0123456789-abcdefghijklmnop"),
    ).toBeNull();
  });
});

describe("pin", () => {
  it("verifies correct and rejects incorrect", async () => {
    const h = await hashPin("1234");
    expect(h).toMatch(/^pbkdf2\$100000\$[\w-]+\$[\w-]+$/);
    expect(await verifyPin("1234", h)).toBe(true);
    expect(await verifyPin("1235", h)).toBe(false);
    expect(await verifyPin("1234", "garbage")).toBe(false);
    expect(await verifyPin("1234", "pbkdf2$100000$abc")).toBe(false);
    expect(await verifyPin("1234", "pbkdf2$100000$$")).toBe(false);
    expect(await verifyPin("1234", "pbkdf2$100000$!!$!!")).toBe(false);
    expect(await verifyPin("1234", h.replace("pbkdf2", "md5"))).toBe(false);
    expect(await verifyPin("1234", h + "$extra")).toBe(false);
    // Huge iteration count must be rejected without running the KDF.
    const [, , salt, hash] = h.split("$");
    expect(await verifyPin("1234", `pbkdf2$999999999$${salt}$${hash}`)).toBe(
      false,
    );
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
  it("accepts base64 and base64url keys, rejects bad ones", async () => {
    const raw = Uint8Array.from({ length: 32 }, (_, i) => 0xfb - (i % 3));
    const std = btoa(String.fromCharCode(...raw));
    expect(std).toMatch(/[+/]/);
    const c = await encryptSecret("x", std);
    expect(await decryptSecret(c, b64urlEncode(raw))).toBe("x");
    const msg =
      "TOKEN_KEY must be base64 of 32 random bytes (openssl rand -base64 32)";
    for (const bad of ["change-me", "", "AAAA", btoa("a".repeat(16))]) {
      await expect(encryptSecret("x", bad)).rejects.toThrow(msg);
    }
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
    const a = await hashIp("1.2.3.4", S);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await hashIp("1.2.3.4", S)).toBe(a);
    expect(await hashIp("1.2.3.4", S + "x")).not.toBe(a);
  });
});
