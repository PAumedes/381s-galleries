import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import { describe, expect, it } from "vitest";
import { PhotoViewer } from "../../app/components/admin/PhotoViewer";
import { allMessages } from "../../app/i18n/dictionaries";

function open() {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang: "es",
        messages: allMessages("es"),
        studioName: "E",
      }),
      Component: () => (
        <>
          <button>behind</button>
          <Outlet />
        </>
      ),
      children: [
        {
          index: true,
          Component: () => (
            <PhotoViewer
              ids={["a", "b"]}
              names={
                new Map([
                  ["a", { name: "A" }],
                  ["b", { name: "B" }],
                ])
              }
              current="a"
              onChange={() => {}}
              onClose={() => {}}
            />
          ),
        },
      ],
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("T6.12 PhotoViewer (aria-modal dialog)", () => {
  it("Tab on the last control wraps inside the dialog instead of escaping to the page behind", async () => {
    open();
    const dialog = await screen.findByRole("dialog");
    const buttons = Array.from(
      dialog.querySelectorAll("button:not([disabled])"),
    );
    const last = buttons[buttons.length - 1] as HTMLElement;
    last.focus();
    // Lightbox preventDefaults + wraps; here nothing handles Tab.
    // The key handler is attached in an effect that can run a tick after the
    // dialog shows up (flaky on a loaded runner): retry until it is there.
    await waitFor(() => {
      const notPrevented = fireEvent.keyDown(last, { key: "Tab" });
      expect(notPrevented).toBe(false);
    });
  });
});
