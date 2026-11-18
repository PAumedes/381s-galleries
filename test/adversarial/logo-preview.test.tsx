import { render, screen, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { es } from "../../app/i18n/es";
import {
  SetupView,
  type SetupViewData,
} from "../../app/components/admin/SetupView";

const V = "0123456789abcdef";
const W = "fedcba9876543210";
const base: SetupViewData = {
  connected: false,
  mock: false,
  rootName: null,
  studioName: "Estudio",
  lastSyncAt: null,
  lastError: null,
};
function setup(logo: SetupViewData["logo"]) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/admin/setup",
      loader: () => ({ lang: "es", messages: es, studioName: "E", logo }),
      Component: () => <SetupView data={{ ...base, logo }} />,
    },
  ]);
  return render(<Stub initialEntries={["/admin/setup"]} />);
}
const file = () =>
  new File([new Uint8Array([1])], "a.png", { type: "image/png" });
const origCreate = URL.createObjectURL;
const origRevoke = URL.revokeObjectURL;
afterEach(() => {
  URL.createObjectURL = origCreate;
  URL.revokeObjectURL = origRevoke;
});

describe("adversarial: Ajustes logo previews", () => {
  it("picking the dark file does not revoke the blob URL still shown for the light preview", async () => {
    const revoked: string[] = [];
    let n = 0;
    URL.createObjectURL = () => `blob:t-${n++}`;
    URL.revokeObjectURL = (u: string) => void revoked.push(u);
    setup({ onLight: null, onDark: null });
    const light = await screen.findByLabelText("Logo para fondos claros");
    const dark = screen.getByLabelText(/Logo para fondos oscuros/);
    fireEvent.change(light, { target: { files: [file()] } }); // blob:t-0
    fireEvent.change(dark, { target: { files: [file()] } }); // blob:t-1
    const lightImg = screen
      .getByTestId("logo-preview-light")
      .querySelector("img")!;
    // still displayed => must not have been revoked (broken preview otherwise)
    expect(lightImg.getAttribute("src")).toBe("blob:t-0");
    expect(revoked).not.toContain("blob:t-0");
  });

  it("choosing a new light logo keeps showing the SAVED dark-background logo on the dark swatch", async () => {
    URL.createObjectURL = () => "blob:new-light";
    URL.revokeObjectURL = () => {};
    setup({ onLight: V, onDark: W });
    const light = await screen.findByLabelText("Logo para fondos claros");
    fireEvent.change(light, { target: { files: [file()] } });
    const darkImg = screen
      .getByTestId("logo-preview-dark")
      .querySelector("img")!;
    expect(darkImg.getAttribute("src")).toBe(`/brand/logo/on-dark?v=${W}`);
  });
});
