import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "../../app/i18n/en";
import { SharePopover } from "../../app/components/SharePopover";
import { SharePanel } from "../../app/components/admin/SharePanel";

function stub(node: React.ReactNode) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "en", messages: en, studioName: "S" }),
      Component: () => <>{node}</>,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}
afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).share;
});

describe("T6.9 SharePopover", () => {
  it("gives visible feedback when the clipboard write fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    const onCopied = vi.fn();
    stub(<SharePopover title="T" onCopied={onCopied} />);
    fireEvent.click(await screen.findByRole("button", { name: "Share" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    });
    expect(onCopied).not.toHaveBeenCalled();
    // Something must tell the user it failed (status/alert or still-open dialog).
    expect(
      screen.queryByRole("alert") ??
        screen.queryByRole("status") ??
        screen.queryByRole("dialog"),
    ).not.toBeNull();
  });

  it("second click while the native sheet is open must not pop the fallback over it", async () => {
    let first!: () => void;
    const share = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (first = r)))
      .mockRejectedValueOnce(new DOMException("busy", "InvalidStateError"));
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
      writable: true,
    });
    stub(<SharePopover title="T" onCopied={() => {}} />);
    const btn = await screen.findByRole("button", { name: "Share" });
    await act(async () => {
      fireEvent.click(btn);
    });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    first();
  });
});

describe("T6.9 SharePanel", () => {
  it("renders for a title containing a lone surrogate", async () => {
    stub(
      <SharePanel
        url="https://x.test/a"
        slug="a"
        title={"Bo\uD83Dda"}
        status="published"
        hasPin={false}
      />,
    );
    expect(await screen.findByText("WhatsApp")).toBeTruthy();
  });
});
