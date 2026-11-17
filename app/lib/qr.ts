/**
 * Browser-side QR helpers. `qrcode` is imported lazily so it never loads on
 * the server (SSR) and only ships when a QR is actually shown.
 */
const OPTS = {
  errorCorrectionLevel: "M" as const,
  margin: 2, // quiet zone, in modules
  color: { dark: "#000000", light: "#ffffff" },
};

async function lib() {
  return (await import("qrcode")).default;
}

export async function qrSvg(url: string): Promise<string> {
  return (await lib()).toString(url, { ...OPTS, type: "svg" });
}

export async function qrPngBlob(url: string, size = 1024): Promise<Blob> {
  const QR = await lib();
  const canvas = document.createElement("canvas");
  await QR.toCanvas(canvas, url, { ...OPTS, width: size });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("png"))),
      "image/png",
    ),
  );
}

export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
