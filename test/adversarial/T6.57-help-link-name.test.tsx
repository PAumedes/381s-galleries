import { cleanup, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Section } from "../../app/components/admin/gallery-edit/ui";

// T6.57: a screen-reader user lists the page's links: eighteen "Ayuda" links
// that go to different answers must say which section they belong to
// (WCAG 2.4.4 link purpose; 2.5.3 label in name for the visible "?").
afterEach(cleanup);

describe("T6.57 adversarial: the ? links have distinct accessible names", () => {
  it("two sections give two different link names", async () => {
    const Stub = createRoutesStub([
      {
        path: "/x",
        Component: () => (
          <>
            <Section title="PIN de acceso" help="access-pin-album">
              <p>a</p>
            </Section>
            <Section title="Eliminar galería" help="albums-delete">
              <p>b</p>
            </Section>
          </>
        ),
      },
    ]);
    render(<Stub initialEntries={["/x"]} />);
    await screen.findByText("PIN de acceso");
    const names = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
  });
});
