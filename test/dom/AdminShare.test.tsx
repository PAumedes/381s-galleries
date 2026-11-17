import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QRCode from "qrcode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharePanel } from "../../app/components/admin/SharePanel";
import { CardView } from "../../app/components/admin/CardView";

const URL_ = "https://g.example.com/boda-ana";
const props = {
  url: URL_,
  slug: "boda-ana",
  status: "published" as const,
  hasPin: false,
};
afterEach(() => vi.restoreAllMocks());

async function expectedSvg(url: string) {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

describe("SharePanel", () => {
  it("shows the URL read-only", () => {
    render(<SharePanel {...props} />);
    const i = screen.getByLabelText("Enlace público") as HTMLInputElement;
    expect(i.value).toBe(URL_);
    expect(i.readOnly).toBe(true);
  });

  it("copy button writes the URL to the clipboard and gives feedback", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<SharePanel {...props} />);
    await user.click(screen.getByRole("button", { name: "Copiar enlace" }));
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(await screen.findByText("Enlace copiado")).toBeTruthy();
  });

  it("hints when not published, not when published", () => {
    const { rerender } = render(<SharePanel {...props} status="draft" />);
    expect(
      screen.getByText("La galería no es visible hasta publicarla"),
    ).toBeTruthy();
    rerender(<SharePanel {...props} status="published" />);
    expect(screen.queryByText(/no es visible hasta publicarla/)).toBeNull();
  });

  it("PIN hint only with a pin and never the pin", () => {
    const { rerender } = render(<SharePanel {...props} />);
    expect(screen.queryByText(/Con PIN/)).toBeNull();
    rerender(<SharePanel {...props} hasPin />);
    expect(screen.getByText("Con PIN — compartilo por separado")).toBeTruthy();
  });

  it("renders the QR as an svg with a path that equals qrcode's output for the URL", async () => {
    const spy = vi.spyOn(QRCode, "toString");
    render(<SharePanel {...props} />);
    const box = await screen.findByTestId("qr");
    await waitFor(() => expect(box.querySelector("svg path")).not.toBeNull());
    expect(spy.mock.calls[0][0]).toBe(URL_);
    expect(spy.mock.calls[0][1]).toMatchObject({
      errorCorrectionLevel: "M",
      margin: 2,
    });
    const ref = document.createElement("div");
    ref.innerHTML = await expectedSvg(URL_);
    expect(box.innerHTML).toBe(ref.innerHTML);
  });

  it("SVG download creates a blob and names it <slug>-qr.svg", async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), "blob:x"));
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    render(<SharePanel {...props} />);
    const box = await screen.findByTestId("qr");
    await waitFor(() => expect(box.querySelector("svg")).not.toBeNull());
    await user.click(
      screen.getByRole("button", { name: "Descargar QR (SVG)" }),
    );
    await waitFor(() => expect(names).toEqual(["boda-ana-qr.svg"]));
    expect(blobs[0].type).toBe("image/svg+xml");
    expect(await blobs[0].text()).toBe(await expectedSvg(URL_));
  });

  it("PNG download renders 1024px via toCanvas and names it <slug>-qr.png", async () => {
    const user = userEvent.setup();
    const toCanvas = vi.spyOn(QRCode, "toCanvas").mockImplementation((async (
      c: HTMLCanvasElement,
    ) => {
      c.toBlob = (cb: BlobCallback) =>
        cb(new Blob(["png"], { type: "image/png" }));
      return c;
    }) as never);
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), "blob:y"));
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    render(<SharePanel {...props} />);
    await user.click(
      screen.getByRole("button", { name: "Descargar QR (PNG 1024px)" }),
    );
    await waitFor(() => expect(names).toEqual(["boda-ana-qr.png"]));
    expect(toCanvas.mock.calls[0][1]).toBe(URL_);
    expect(toCanvas.mock.calls[0][2]).toMatchObject({
      width: 1024,
      errorCorrectionLevel: "M",
      margin: 2,
    });
    expect(blobs[0].type).toBe("image/png");
  });
});

describe("CardView", () => {
  const card = {
    title: "Boda Ana",
    eventDate: "2026-11-01",
    url: URL_,
    hasPin: false,
    studioName: "381 Studios",
    lang: "es" as const,
  };

  it("renders title, localized date, url, studio, logo and QR of exactly the URL", async () => {
    const spy = vi.spyOn(QRCode, "toString");
    render(<CardView {...card} />);
    expect(screen.getByRole("heading", { name: "Boda Ana" })).toBeTruthy();
    expect(screen.getByText("1 de noviembre de 2026")).toBeTruthy();
    expect(screen.getByText(URL_)).toBeTruthy();
    expect(screen.getByText("381 Studios")).toBeTruthy();
    expect(
      document.querySelector('img[src="/brand/logo-black.svg"]'),
    ).not.toBeNull();
    const box = await screen.findByTestId("qr");
    await waitFor(() => expect(box.querySelector("svg path")).not.toBeNull());
    expect(spy.mock.calls[0][0]).toBe(URL_);
  });

  it("PIN line only when the gallery has a PIN, and never the PIN", () => {
    const { rerender } = render(<CardView {...card} />);
    expect(screen.queryByText(/PIN:/)).toBeNull();
    rerender(<CardView {...card} hasPin />);
    expect(screen.getByText(/^PIN: _+$/)).toBeTruthy();
  });

  it("english date and language toggle", () => {
    render(<CardView {...card} lang="en" />);
    expect(screen.getByText("November 1, 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "ES" })).toBeTruthy();
  });

  it("print button calls window.print and is hidden in print", async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    window.print = print;
    render(<CardView {...card} />);
    const b = screen.getByRole("button", { name: "Imprimir" });
    expect(b.closest(".print\\:hidden")).not.toBeNull();
    await user.click(b);
    expect(print).toHaveBeenCalled();
  });

  it("omits the date line when there is no date", () => {
    render(<CardView {...card} eventDate={null} />);
    expect(screen.queryByText(/2026/)).toBeNull();
  });
});

describe("QrCode failure and url change", () => {
  it("shows an error and disables downloads when generation fails", async () => {
    vi.spyOn(QRCode, "toString").mockRejectedValue(new Error("boom"));
    render(<SharePanel {...props} />);
    expect(await screen.findByText("No se pudo generar el QR")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Descargar QR (SVG)",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Descargar QR (PNG 1024px)",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("clears the stale svg and notifies the parent when url changes", async () => {
    const { QrCode } = await import("../../app/components/admin/QrCode");
    const seen: string[] = [];
    const { rerender } = render(
      <QrCode url={URL_} onSvg={(s) => seen.push(s)} />,
    );
    await waitFor(() => expect(seen.at(-1)).toContain("<svg"));
    vi.spyOn(QRCode, "toString").mockRejectedValue(new Error("boom"));
    rerender(
      <QrCode url="https://g.example.com/otro" onSvg={(s) => seen.push(s)} />,
    );
    await screen.findByText("No se pudo generar el QR");
    expect(seen.at(-1)).toBe("");
    expect(screen.getByTestId("qr").querySelector("svg")).toBeNull();
  });
});
