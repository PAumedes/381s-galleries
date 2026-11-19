import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { es } from "../../app/i18n/es";
import { Logo, logoSource } from "../../app/components/Logo";
import { CardView } from "../../app/components/admin/CardView";

const V = "0123456789abcdef";
type Versions = { onLight: string | null; onDark: string | null };

async function stub(
  node: ReactNode,
  o: { studioName?: string; logo?: Versions } = {},
) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "es", messages: es, ...o }),
      Component: () => <>{node}</>,
    },
  ]);
  const r = render(<Stub initialEntries={["/"]} />);
  await waitFor(() =>
    expect(document.querySelector("[data-logo=wordmark], img")).not.toBeNull(),
  );
  return r;
}
const mark = () => document.querySelector("[data-logo=wordmark]");
afterEach(cleanup);

describe("T6.21 neutral wordmark when no logo is uploaded", () => {
  it("logoSource is null without an upload (no bundled owner logo)", () => {
    expect(logoSource("dark")).toBeNull();
    expect(logoSource("light", { onLight: null, onDark: null })).toBeNull();
    expect(logoSource("dark", { onLight: null, onDark: V })).toBeNull();
  });
  it("shows the studio name as text, no image", async () => {
    await stub(<Logo className="h-8" />, { studioName: "Estudio Luz" });
    await screen.findByText("Estudio Luz");
    expect(mark()!.tagName).not.toBe("IMG");
    expect(document.querySelector("img")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/logo-(black|white)\.svg/);
  });
  it("studio name unset falls back to Galleries", async () => {
    await stub(<Logo />);
    await screen.findByText("Galleries");
  });
  it("the name prop wins; HTML characters stay text", async () => {
    await stub(<Logo name={`<b>x</b> & "y"`} />, { studioName: "Estudio" });
    await screen.findByText(`<b>x</b> & "y"`);
    expect(document.querySelector("b")).toBeNull();
  });
  it("dark variant reads on light, light variant on dark", async () => {
    await stub(
      <>
        <Logo variant="dark" name="A" />
        <Logo variant="light" name="B" />
      </>,
    );
    await screen.findByText("A");
    expect(screen.getByText("A").className).toMatch(/text-black/);
    expect(screen.getByText("B").className).toMatch(/text-white/);
  });
  it("long names truncate inside the box", async () => {
    await stub(<Logo name={"Muy ".repeat(40)} className="h-24" />);
    const el = mark() as HTMLElement;
    expect(el.className).toMatch(/max-w-full/);
    expect(el.className).toMatch(/truncate/);
    expect(el.className).toMatch(/h-24/);
  });
  it("an uploaded logo keeps the image (alt = name)", async () => {
    await stub(<Logo />, {
      studioName: "Estudio",
      logo: { onLight: V, onDark: null },
    });
    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")).toBe(`/brand/logo/on-light?v=${V}`);
    expect(mark()).toBeNull();
  });
  it("a dark-only upload still shows text on light backgrounds", async () => {
    await stub(<Logo variant="dark" />, {
      studioName: "Estudio",
      logo: { onLight: null, onDark: V },
    });
    await screen.findByText("Estudio");
  });
  it("the share card prints the name instead of an image", async () => {
    render(
      <CardView
        title="Boda"
        eventDate={null}
        url="https://x.test/g"
        hasPin={false}
        studioName="Estudio Luz"
        lang="es"
      />,
    );
    expect(document.querySelector("article img")).toBeNull();
    expect(
      document.querySelector("article [data-logo=wordmark]")!.textContent,
    ).toBe("Estudio Luz");
  });
  it("no logo SVGs are shipped under public/brand", () => {
    for (const f of ["brand/logo-black.svg", "brand/logo-white.svg"])
      expect(existsSync(path.join(process.cwd(), "public", f))).toBe(false);
  });
});

describe("T6.22 wordmark script handling", () => {
  it("dir=auto; wide tracking for Latin names, none for Arabic/Hebrew", async () => {
    await stub(<Logo name="Estudio" className="h-8" />);
    expect(mark()!.getAttribute("dir")).toBe("auto");
    expect(mark()!.className).toMatch(/tracking-\[0\.2em\]/);
    cleanup();
    await stub(<Logo name="استوديو" className="h-8" />);
    expect(mark()!.className).not.toMatch(/tracking-/);
    cleanup();
    await stub(<Logo name="סטודיו" className="h-8" />);
    expect(mark()!.className).not.toMatch(/tracking-/);
  });
});
