import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { DEFAULT_STUDIO_NAME } from "../../app/lib/default-studio-name";
import { useStudioName } from "../../app/lib/use-studio-name";

function Show() {
  return <p data-testid="n">{useStudioName()}</p>;
}
const mount = (loader?: () => unknown) => {
  const Stub = createRoutesStub([
    { id: "root", path: "/", Component: Show, loader: loader as never },
  ]);
  render(<Stub initialEntries={["/"]} />);
};

describe("T6.20 useStudioName fallback", () => {
  it("uses the default without root loader data", async () => {
    mount();
    expect((await screen.findByTestId("n")).textContent).toBe(
      DEFAULT_STUDIO_NAME,
    );
  });
  it("uses the loader's studio name when present", async () => {
    mount(() => ({ studioName: "Luz" }));
    expect((await screen.findByTestId("n")).textContent).toBe("Luz");
  });
});
