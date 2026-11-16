// Web Crypto helpers only (no node:crypto).
const enc = new TextEncoder();
const dec = new TextDecoder();

const PBKDF2_ITERATIONS = 100_000;

export function newId(): string {
  return crypto.randomUUID();
}

export function b64urlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Throws on malformed input. */
export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("invalid base64url");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

/** `base64url(json with exp).base64url(HMAC-SHA256)`. `exp` is unix seconds. */
export async function signToken(
  payload: object,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = b64urlEncode(JSON.stringify({ ...payload, exp }));
  const key = await hmacKey(secret, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Returns the payload (including `exp`) or null if malformed, forged or expired. */
export async function verifyToken<T>(
  token: string,
  secret: string,
): Promise<T | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  try {
    const key = await hmacKey(secret, ["verify"]);
    // subtle.verify compares in constant time.
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(sig),
      enc.encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(body))) as unknown;
    if (typeof payload !== "object" || payload === null) return null;
    const exp = (payload as { exp?: unknown }).exp;
    if (typeof exp !== "number" || exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload as T;
  } catch {
    return null;
  }
}

async function derivePin(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Format: `pbkdf2$100000$<salt b64url>$<hash b64url>`. */
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePin(pin, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iter, saltB64, hashB64] = stored.split("$");
    const iterations = Number(iter);
    if (
      scheme !== "pbkdf2" ||
      !Number.isInteger(iterations) ||
      iterations < 1
    ) {
      return false;
    }
    const expected = b64urlDecode(hashB64);
    const actual = await derivePin(pin, b64urlDecode(saltB64), iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function aesKey(keyB64: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("TOKEN_KEY must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, usages);
}

/** AES-256-GCM. Output: `<iv b64url>.<ciphertext b64url>`. */
export async function encryptSecret(
  plain: string,
  keyB64: string,
): Promise<string> {
  const key = await aesKey(keyB64, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plain),
  );
  return `${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ct))}`;
}

/** Throws if the ciphertext is malformed or has been tampered with. */
export async function decryptSecret(
  ciphertext: string,
  keyB64: string,
): Promise<string> {
  const [ivB64, ctB64, ...rest] = ciphertext.split(".");
  if (!ivB64 || !ctB64 || rest.length) throw new Error("invalid ciphertext");
  const key = await aesKey(keyB64, ["decrypt"]);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64urlDecode(ivB64) },
    key,
    b64urlDecode(ctB64),
  );
  return dec.decode(pt);
}

/** Short keyed hash (16 hex chars) so raw IPs are never stored or logged. */
export async function hashIp(ip: string, secret: string): Promise<string> {
  const key = await hmacKey(secret, ["sign"]);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(ip)),
  );
  return Array.from(sig.slice(0, 8), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
