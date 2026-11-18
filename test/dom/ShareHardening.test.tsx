import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { SharePopover } from "../../app/components/SharePopover";
import { SharePanel } from "../../app/components/admin/SharePanel";

function stub(
  node: ReactNode,
  extra: Record<string, unknown> = {},
  lang = "en",
) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang,
        messages: lang === "en" ? en : es,
        studioName: "S",
        ...extra,
      }),
      Component: () => <>{node}</>,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}
function setShare(fn: unknown) {
  Object.defineProperty(navigator, "share", {
    value: fn,
    configurable: true,
    writable: true,
  });
}
afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).share;
});
const open = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Share" }));
};

describe("SharePopover copy failure", () => {
  it("keeps the popover open with a status message and a selectable URL", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
      configurable: true,
    });
    stub(<SharePopover title="T" onCopied={() => {}} />);
    await open();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Couldn't copy");
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(
      `${window.location.origin}${window.location.pathname}`,
    );
  });

  it("handles a missing clipboard, localized", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    stub(<SharePopover title="T" onCopied={() => {}} />, {}, "es");
    fireEvent.click(await screen.findByRole("button", { name: "Compartir" }));
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Copiar enlace" }),
      );
    });
    expect(screen.getByRole("status").textContent).toBe("No se pudo copiar");
  });

  it("success still closes and reports", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const onCopied = vi.fn();
    stub(<SharePopover title="T" onCopied={onCopied} />);
    await open();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    });
    expect(onCopied).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("SharePopover native share", () => {
  it("treats InvalidStateError as cancelled (no fallback)", async () => {
    setShare(
      vi.fn().mockRejectedValue(new DOMException("x", "InvalidStateError")),
    );
    stub(<SharePopover title="T" onCopied={() => {}} />);
    const btn = await screen.findByRole("button", { name: "Share" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores clicks while a share is pending", async () => {
    let done!: () => void;
    const share = vi.fn(() => new Promise<void>((r) => (done = r)));
    setShare(share);
    stub(<SharePopover title="T" onCopied={() => {}} />);
    const btn = await screen.findByRole("button", { name: "Share" });
    await act(async () => {
      fireEvent.click(btn);
    });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(share).toHaveBeenCalledTimes(1);
    await act(async () => done());
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(share).toHaveBeenCalledTimes(2);
  });
});

describe("SharePopover url and dismissal", () => {
  it("uses the PUBLIC_ORIGIN from the root loader", async () => {
    stub(<SharePopover title="T" onCopied={() => {}} />, {
      origin: "https://gallery.example.com",
    });
    await open();
    const a = screen.getByRole("link") as HTMLAnchorElement;
    expect(decodeURIComponent(a.href)).toContain(
      `https://gallery.example.com${window.location.pathname}`,
    );
  });

  it("closes on pointerdown outside", async () => {
    stub(<SharePopover title="T" onCopied={() => {}} />);
    await open();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when focus leaves the popover", async () => {
    stub(
      <>
        <SharePopover title="T" onCopied={() => {}} />
        <button>outside</button>
      </>,
    );
    await open();
    const outside = screen.getByRole("button", { name: "outside" });
    fireEvent.focusOut(screen.getByRole("dialog"), { relatedTarget: outside });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("returns focus to the share button on Escape", async () => {
    stub(<SharePopover title="T" onCopied={() => {}} />);
    await open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Share" }),
    );
  });
});

describe("admin SharePanel unpublished", () => {
  it.each(["draft", "archived"] as const)(
    "disables share and WhatsApp when %s",
    async (status) => {
      setShare(vi.fn());
      stub(
        <SharePanel
          url="https://x.test/a"
          slug="a"
          status={status}
          hasPin={false}
        />,
      );
      const native = await screen.findByRole("button", { name: "Share…" });
      expect((native as HTMLButtonElement).disabled).toBe(true);
      const wa = screen.getByText("WhatsApp");
      expect(wa.getAttribute("aria-disabled")).toBe("true");
      expect(wa.getAttribute("href")).toBeNull();
      expect(screen.getByText(/isn't visible/)).toBeTruthy();
      expect(
        (screen.getByRole("button", { name: "Copy link" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    },
  );

  it("keeps them enabled when published", async () => {
    setShare(vi.fn());
    stub(
      <SharePanel
        url="https://x.test/a"
        slug="a"
        status="published"
        hasPin={false}
      />,
    );
    expect(
      (
        (await screen.findByRole("button", {
          name: "Share…",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.getByText("WhatsApp").getAttribute("href")).toContain(
      "wa.me",
    );
  });
});
