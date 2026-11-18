import { render, screen, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { es } from "../../app/i18n/es";
import { Logo, logoSource } from "../../app/components/Logo";
import { CardView } from "../../app/components/admin/CardView";
import {
  SetupView,
  type SetupViewData,
} from "../../app/components/admin/SetupView";

type Versions = { onLight: string | null; onDark: string | null };
function stub(node: ReactNode, logo?: Versions) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "es", messages: es, studioName: "Estudio", logo }),
      Component: () => <>{node}</>,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}
const V = "0123456789abcdef";
const W = "fedcba9876543210";
const src = async () =>
  (await screen.findByRole("img")).getAttribute("src") as string;

describe("logoSource", () => {
  it("defaults to the bundled files", () => {
    expect(logoSource("dark")).toMatchObject({ src: "/brand/logo-black.svg" });
    expect(logoSource("light")).toMatchObject({ src: "/brand/logo-white.svg" });
    expect(logoSource("light", { onLight: null, onDark: null }).src).toBe(
      "/brand/logo-white.svg",
    );
  });
  it("uses the uploaded files via the dedicated route with the version", () => {
    expect(logoSource("dark", { onLight: V, onDark: W }).src).toBe(
      `/brand/logo/on-light?v=${V}`,
    );
    expect(logoSource("light", { onLight: V, onDark: W }).src).toBe(
      `/brand/logo/on-dark?v=${W}`,
    );
  });
  it("without a dark upload, inverts the light one; a dark-only upload keeps the bundled light-bg logo", () => {
    expect(logoSource("light", { onLight: V, onDark: null })).toMatchObject({
      src: `/brand/logo/on-light?v=${V}`,
      invert: true,
    });
    expect(logoSource("dark", { onLight: null, onDark: W }).src).toBe(
      "/brand/logo-black.svg",
    );
  });
  it("encodes a hostile version", () => {
    expect(
      logoSource("dark", { onLight: '"><script>', onDark: null }).src,
    ).not.toMatch(/[<>"]/);
  });
});

describe("Logo component", () => {
  it("renders the bundled logo by default", async () => {
    stub(<Logo />);
    expect(await src()).toBe("/brand/logo-black.svg");
  });
  it("renders the configured logo, never inlining it", async () => {
    stub(<Logo variant="dark" />, { onLight: V, onDark: null });
    expect(await src()).toBe(`/brand/logo/on-light?v=${V}`);
    expect(document.querySelector("svg, object, iframe, embed")).toBeNull();
  });
  it("inverts via CSS when only the light-background logo exists", async () => {
    stub(<Logo variant="light" />, { onLight: V, onDark: null });
    const img = await screen.findByRole("img");
    expect(img.className).toMatch(/brightness-0/);
    expect(img.className).toMatch(/\binvert\b/);
  });
});

describe("printable card", () => {
  it("uses the configured logo", async () => {
    stub(
      <CardView
        title="T"
        eventDate={null}
        url="https://x.example/g"
        hasPin={false}
        studioName="Estudio"
        lang="es"
        logo={{ onLight: V, onDark: null }}
      />,
    );
    await screen.findByText("T");
    expect(
      document.querySelector(`img[src="/brand/logo/on-light?v=${V}"]`),
    ).toBeTruthy();
  });
});

const base: SetupViewData = {
  connected: false,
  mock: false,
  rootName: null,
  studioName: "Estudio",
  lastSyncAt: null,
  lastError: null,
};
function setup(data: Partial<SetupViewData> = {}, actionData?: unknown) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/admin/setup",
      loader: () => ({
        lang: "es",
        messages: es,
        studioName: "Estudio",
        logo: data.logo ?? { onLight: null, onDark: null },
      }),
      Component: () => (
        <SetupView
          data={{ ...base, ...data }}
          actionData={actionData as never}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin/setup"]} />);
}

const origCreate = URL.createObjectURL;
const origRevoke = URL.revokeObjectURL;
afterEach(() => {
  URL.createObjectURL = origCreate;
  URL.revokeObjectURL = origRevoke;
});
const png = () =>
  new File([new Uint8Array([1])], "a.png", { type: "image/png" });
const previewSrc = (id: string) =>
  screen.getByTestId(id).querySelector("img")!.getAttribute("src");

describe("Logo card in Ajustes", () => {
  it("has two multipart upload forms with restricted accept, 16px-capable inputs and a reset", async () => {
    setup();
    const light = await screen.findByLabelText("Logo para fondos claros");
    const dark = screen.getByLabelText(/Logo para fondos oscuros/);
    for (const el of [light, dark]) {
      const input = el as HTMLInputElement;
      expect(input.type).toBe("file");
      expect(input.name).toBe("file");
      expect(input.accept).toBe(
        "image/png,image/jpeg,image/webp,image/svg+xml",
      );
      const form = input.closest("form")!;
      expect(form.getAttribute("enctype")).toBe("multipart/form-data");
      expect(form.method).toBe("post");
      // intent comes before the file so it is parsed first
      const names = Array.from(form.elements).map(
        (x) => (x as HTMLInputElement).name,
      );
      expect(names.indexOf("intent")).toBeLessThan(names.indexOf("file"));
    }
    expect(
      (light.closest("form")!.elements.namedItem("variant") as HTMLInputElement)
        .value,
    ).toBe("on-light");
    expect(
      (dark.closest("form")!.elements.namedItem("variant") as HTMLInputElement)
        .value,
    ).toBe("on-dark");
    expect(screen.getByRole("button", { name: "Restablecer" })).toBeTruthy();
  });
  it("is a fifth card outside the four-card row", async () => {
    const { container } = setup();
    await screen.findByLabelText("Logo para fondos claros");
    const grid = container.querySelector("[data-testid=setup-cards]")!;
    expect(grid.children).toHaveLength(4);
    expect(
      grid.contains(screen.getByLabelText("Logo para fondos claros")),
    ).toBe(false);
  });
  it("previews the current logo on a light and a dark swatch (bundled by default)", async () => {
    setup();
    await screen.findByLabelText("Logo para fondos claros");
    const light = screen.getByTestId("logo-preview-light");
    const dark = screen.getByTestId("logo-preview-dark");
    expect(light.querySelector("img")!.getAttribute("src")).toBe(
      "/brand/logo-black.svg",
    );
    expect(dark.querySelector("img")!.getAttribute("src")).toBe(
      "/brand/logo-white.svg",
    );
    expect(
      (screen.getByRole("button", { name: "Restablecer" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("previews configured logos and enables reset", async () => {
    setup({ logo: { onLight: V, onDark: null } });
    await screen.findByLabelText("Logo para fondos claros");
    expect(
      screen
        .getByTestId("logo-preview-light")
        .querySelector("img")!
        .getAttribute("src"),
    ).toBe(`/brand/logo/on-light?v=${V}`);
    const dark = screen.getByTestId("logo-preview-dark").querySelector("img")!;
    expect(dark.getAttribute("src")).toBe(`/brand/logo/on-light?v=${V}`);
    expect(dark.className).toMatch(/invert/);
    expect(
      (screen.getByRole("button", { name: "Restablecer" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("shows a local preview of a chosen file before uploading", async () => {
    const urls: string[] = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b: Blob | MediaSource) => {
      void b;
      const u = `blob:test-${urls.length}`;
      urls.push(u);
      return u;
    };
    URL.revokeObjectURL = () => {};
    try {
      setup();
      const input = (await screen.findByLabelText(
        "Logo para fondos claros",
      )) as HTMLInputElement;
      const file = new File([new Uint8Array([1])], "a.png", {
        type: "image/png",
      });
      fireEvent.change(input, { target: { files: [file] } });
      const img = screen
        .getByTestId("logo-preview-light")
        .querySelector("img")!;
      expect(img.getAttribute("src")).toBe(urls[0]);
    } finally {
      URL.createObjectURL = orig;
    }
  });
  it("shows server errors and success for the logo intents", async () => {
    setup(
      {},
      { intent: "logo", ok: false, error: "El archivo supera los 512 KB." },
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("El archivo supera los 512 KB.")).toBeTruthy();
  });
  it("a second pick (dark) keeps the light preview and revokes nothing in use", async () => {
    const revoked: string[] = [];
    let n = 0;
    URL.createObjectURL = () => `blob:p-${n++}`;
    URL.revokeObjectURL = (u: string) => void revoked.push(u);
    setup();
    const light = await screen.findByLabelText("Logo para fondos claros");
    fireEvent.change(light, { target: { files: [png()] } });
    fireEvent.change(screen.getByLabelText(/Logo para fondos oscuros/), {
      target: { files: [png()] },
    });
    expect(previewSrc("logo-preview-light")).toBe("blob:p-0");
    expect(previewSrc("logo-preview-dark")).toBe("blob:p-1");
    expect(revoked).toEqual([]);
  });
  it("re-picking a slot revokes only that slot's previous blob", async () => {
    const revoked: string[] = [];
    let n = 0;
    URL.createObjectURL = () => `blob:q-${n++}`;
    URL.revokeObjectURL = (u: string) => void revoked.push(u);
    setup();
    const light = await screen.findByLabelText("Logo para fondos claros");
    fireEvent.change(light, { target: { files: [png()] } });
    fireEvent.change(light, { target: { files: [png()] } });
    expect(revoked).toEqual(["blob:q-0"]);
    expect(previewSrc("logo-preview-light")).toBe("blob:q-1");
  });
  it("revokes every remaining blob on unmount", async () => {
    const revoked: string[] = [];
    let n = 0;
    URL.createObjectURL = () => `blob:u-${n++}`;
    URL.revokeObjectURL = (u: string) => void revoked.push(u);
    const { unmount } = setup();
    const light = await screen.findByLabelText("Logo para fondos claros");
    fireEvent.change(light, { target: { files: [png()] } });
    fireEvent.change(screen.getByLabelText(/Logo para fondos oscuros/), {
      target: { files: [png()] },
    });
    unmount();
    expect(revoked.sort()).toEqual(["blob:u-0", "blob:u-1"]);
  });
  it("a dark-only pick previews on the dark swatch and leaves the light one alone", async () => {
    URL.createObjectURL = () => "blob:dark-only";
    URL.revokeObjectURL = () => {};
    setup();
    await screen.findByLabelText("Logo para fondos claros");
    fireEvent.change(screen.getByLabelText(/Logo para fondos oscuros/), {
      target: { files: [png()] },
    });
    expect(previewSrc("logo-preview-dark")).toBe("blob:dark-only");
    expect(previewSrc("logo-preview-light")).toBe("/brand/logo-black.svg");
  });
  it("a new light pick is inverted on the dark swatch when there is no dark logo", async () => {
    URL.createObjectURL = () => "blob:l";
    URL.revokeObjectURL = () => {};
    setup({ logo: { onLight: V, onDark: null } });
    await screen.findByLabelText("Logo para fondos claros");
    fireEvent.change(screen.getByLabelText("Logo para fondos claros"), {
      target: { files: [png()] },
    });
    const img = screen.getByTestId("logo-preview-dark").querySelector("img")!;
    expect(img.getAttribute("src")).toBe("blob:l");
    expect(img.className).toMatch(/invert/);
  });
  it("asks for confirmation before resetting (window.confirm); declining submits nothing", async () => {
    const orig = window.confirm;
    const asked: string[] = [];
    window.confirm = (m?: string) => (asked.push(String(m)), false);
    try {
      setup({ logo: { onLight: V, onDark: null } });
      await screen.findByLabelText("Logo para fondos claros");
      const btn = screen.getByRole("button", { name: "Restablecer" });
      const ok = fireEvent.submit(btn.closest("form")!);
      expect(asked).toHaveLength(1);
      expect(ok).toBe(false); // preventDefault called
    } finally {
      window.confirm = orig;
    }
  });
});
