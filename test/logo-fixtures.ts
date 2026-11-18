// Byte fixtures for the logo upload tests.
const enc = new TextEncoder();
export const bytes = (...parts: (number[] | Uint8Array | string)[]) => {
  const arrs = parts.map((p) =>
    typeof p === "string" ? enc.encode(p) : Uint8Array.from(p),
  );
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
const u32 = (n: number) => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const chunk = (type: string, data: number[]) =>
  bytes(u32(data.length), type, data, [0, 0, 0, 0]);

/** Structurally valid 1x1 PNG (CRCs are not checked by the app). */
export const PNG = bytes(
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  chunk("IHDR", [...u32(1), ...u32(1), 8, 6, 0, 0, 0]),
  chunk("IDAT", [0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1]),
  chunk("IEND", []),
);
export const JPEG = bytes(
  [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10],
  "JFIF\0",
  [1, 1, 0, 0, 1, 0, 1, 0, 0],
  [0xff, 0xd9],
);
const le32 = (n: number) => [
  n & 255,
  (n >>> 8) & 255,
  (n >>> 16) & 255,
  (n >>> 24) & 255,
];
export const webp = (declared?: number) => {
  const body = bytes("WEBP", "VP8L", le32(5), [0x2f, 0, 0, 0, 0], [0]);
  return bytes("RIFF", le32(declared ?? body.length), body);
};
export const WEBP = webp();
export const GIF = bytes("GIF89a", [1, 0, 1, 0, 0, 0, 0], [0x3b]);
export const svg = (inner = '<path d="M0 0h10v10z"/>', attrs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"${attrs}>${inner}</svg>`;
export const SVG_OK = svg();

export function multipart(
  fields: Record<
    string,
    string | { name: string; type: string; data: Uint8Array }
  >,
  headers: HeadersInit = {},
  url = "http://localhost/admin/setup",
) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") fd.set(k, v);
    else fd.set(k, new File([v.data as BlobPart], v.name, { type: v.type }));
  }
  return new Request(url, { method: "POST", headers, body: fd });
}
