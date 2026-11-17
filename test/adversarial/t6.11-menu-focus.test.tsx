import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, Outlet } from "react-router";
import { describe, expect, it } from "vitest";
import { AdminShell } from "../../app/components/admin/AdminShell";
import { allMessages } from "../../app/i18n/dictionaries";
import { es } from "../../app/i18n/es";

const status = {
  mock: false,
  connected: true,
  lastSyncAt: null,
  lastError: null,
};

function shell() {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang: "es",
        messages: allMessages("es"),
        studioName: "E",
      }),
      Component: () => <Outlet />,
      children: [
        {
          path: "admin/*",
          Component: () => (
            <AdminShell status={status}>
              <p>content</p>
            </AdminShell>
          ),
        },
      ],
    },
  ]);
  return render(<Stub initialEntries={["/admin"]} />);
}

describe("T6.11 adversarial: mobile menu", () => {
  it("Escape with focus inside the panel returns focus to the toggle", async () => {
    shell();
    const toggle = await screen.findByRole("button", {
      name: es["admin.nav.menu"],
    });
    await userEvent.click(toggle);
    const panel = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    )!;
    const link = panel.querySelector("a")!;
    link.focus();
    expect(document.activeElement).toBe(link);
    await userEvent.keyboard("{Escape}");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // The panel becomes display:none, so focus would drop to <body>.
    expect(document.activeElement).toBe(toggle);
  });

  it("tapping the already-active nav link closes the menu", async () => {
    shell();
    const toggle = await screen.findByRole("button", {
      name: es["admin.nav.menu"],
    });
    await userEvent.click(toggle);
    const panel = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    )!;
    const active = panel.querySelector(
      "nav a[aria-current='page']",
    ) as HTMLElement;
    expect(active).toBeTruthy();
    await userEvent.click(active);
    // pathname does not change, so the render-time reset never fires.
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
