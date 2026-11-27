import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { AdminShell } from "../../app/components/admin/AdminShell";
import { HelpLink } from "../../app/components/admin/help/HelpLink";
import { HelpView } from "../../app/components/admin/help/HelpView";
import { Section } from "../../app/components/admin/gallery-edit/ui";
import { en } from "../../app/i18n/en";
import { setFallbackMessages } from "../../app/i18n/fallback";
import { es } from "../../app/i18n/es";
import { HELP_SECTIONS } from "../../app/lib/help";

// T6.57: the help page, rendered like the admin does (Spanish by default).

const ITEMS = HELP_SECTIONS.flatMap((s) => s.items);

function show(path = "/admin/ayuda") {
  const Stub = createRoutesStub([
    { path: "/admin/ayuda", Component: HelpView },
  ]);
  return render(<Stub initialEntries={[path]} />);
}

afterEach(() => setFallbackMessages(es));

describe("T6.57 HelpView: structure", () => {
  it("one h1, a search box, section links and every question as a collapsed details", async () => {
    show();
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
      es["admin.help.title"],
    );
    expect(screen.getByRole("searchbox")).toBeTruthy();
    const nav = screen.getByRole("navigation", {
      name: es["admin.help.toc"],
    });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      HELP_SECTIONS.map((s) => `#${s.id}`),
    );
    const details = document.querySelectorAll("details");
    expect(details.length).toBe(ITEMS.length);
    for (const d of details) expect((d as HTMLDetailsElement).open).toBe(false);
  });

  it("anchors: item ids and section ids exist once; each item is a native details > summary", async () => {
    show();
    await screen.findByRole("heading", { level: 1 });
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of HELP_SECTIONS) {
      const sec = document.getElementById(s.id)!;
      expect(sec.tagName).toBe("SECTION");
      expect(sec.querySelector("h2")).toBeTruthy();
      for (const i of s.items) {
        const d = document.getElementById(i.id)!;
        expect(d.tagName).toBe("DETAILS");
        expect(sec.contains(d)).toBe(true);
        expect(d.firstElementChild?.tagName).toBe("SUMMARY");
      }
    }
  });

  it("opens and closes when its question is clicked (Enter and Space: real Chrome test)", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole("heading", { level: 1 });
    const d = document.getElementById("albums-publish") as HTMLDetailsElement;
    const summary = d.querySelector("summary") as HTMLElement;
    await user.click(summary);
    expect(d.open).toBe(true);
    await user.click(summary);
    expect(d.open).toBe(false);
  });

  it("answers render real button names in bold with typographic quotes, steps in an ordered list", async () => {
    show();
    await screen.findByRole("heading", { level: 1 });
    const d = document.getElementById("albums-publish")!;
    const ol = d.querySelector("ol")!;
    expect(ol.querySelectorAll("li").length).toBeGreaterThanOrEqual(2);
    expect(ol.querySelectorAll("li").length).toBeLessThanOrEqual(6);
    const strong = [...d.querySelectorAll("strong")].map((s) => s.textContent);
    expect(strong).toContain(`«${es["admin.edit.action.publish"]}»`);
    // Folder names are code, not quoted labels.
    const f = document.getElementById("drive-folders")!;
    expect(f.querySelector("code")?.textContent).toBe("high-res");
    expect(f.textContent).not.toMatch(/\{\w+\}/);
  });

  it("answers without steps are one paragraph; lists of choices are bullets", async () => {
    show();
    await screen.findByRole("heading", { level: 1 });
    const d =
      document.getElementById("drive-readonly") ??
      document.getElementById("start-what")!;
    expect(d.querySelectorAll("p").length).toBe(1);
    expect(d.querySelector("ol, ul")).toBeNull();
    const modes = document.getElementById("proof-modes")!;
    expect(modes.querySelector("ul")).toBeTruthy();
  });
});

describe("T6.57 HelpView: search", () => {
  it("filters live, ignoring case and accents, and says how many matched", async () => {
    const user = userEvent.setup();
    show();
    const box = await screen.findByRole("searchbox");
    await user.type(box, "SINCRONIZACION");
    const visible = [...document.querySelectorAll("details")].filter(
      (d) => !d.hidden,
    );
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(ITEMS.length);
    expect(screen.getByRole("status").textContent).toContain(
      String(visible.length),
    );
    // Matching answers are shown open, so the owner sees the answer at once.
    expect((visible[0] as HTMLDetailsElement).open).toBe(true);
    // Sections with no match disappear.
    for (const s of document.querySelectorAll("section[id]"))
      expect(s.querySelectorAll("details").length).toBeGreaterThan(0);
  });

  it("says so when nothing matches, and clearing the box brings everything back", async () => {
    const user = userEvent.setup();
    show();
    const box = await screen.findByRole("searchbox");
    await user.type(box, "zzzzqqq");
    expect(document.querySelectorAll("details").length).toBe(0);
    expect(screen.getByRole("status").textContent).toBe(
      es["admin.help.search.none"],
    );
    await user.clear(box);
    expect(document.querySelectorAll("details").length).toBe(ITEMS.length);
    for (const d of document.querySelectorAll("details"))
      expect((d as HTMLDetailsElement).open).toBe(false);
  });

  it("works without scripts: a GET form, and ?q= filters on first render", async () => {
    show("/admin/ayuda?q=pin");
    const box = (await screen.findByRole("searchbox")) as HTMLInputElement;
    expect(box.value).toBe("pin");
    expect(box.name).toBe("q");
    const form = box.closest("form")!;
    expect(form.method).toBe("get");
    expect(within(form).getByRole("button")).toBeTruthy();
    const n = document.querySelectorAll("details").length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(ITEMS.length);
  });
});

describe("T6.57 HelpView: links into an answer", () => {
  it("#anchor opens that answer", async () => {
    show("/admin/ayuda#albums-publish");
    await screen.findByRole("heading", { level: 1 });
    expect(
      (document.getElementById("albums-publish") as HTMLDetailsElement).open,
    ).toBe(true);
    expect(
      (document.getElementById("albums-create") as HTMLDetailsElement).open,
    ).toBe(false);
  });
  it("an anchor that is a section does not open anything", async () => {
    show("/admin/ayuda#drive");
    await screen.findByRole("heading", { level: 1 });
    for (const d of document.querySelectorAll("details"))
      expect((d as HTMLDetailsElement).open).toBe(false);
  });
});

describe("T6.57 HelpView: English", () => {
  it("shows the English texts and the English button names", async () => {
    setFallbackMessages(en);
    show();
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
      en["admin.help.title"],
    );
    expect(en["admin.help.title"]).not.toBe(es["admin.help.title"]);
    const strong = [
      ...document.getElementById("albums-publish")!.querySelectorAll("strong"),
    ].map((s) => s.textContent);
    expect(strong).toContain(`«${en["admin.edit.action.publish"]}»`);
  });
});

describe("T6.57 links to the help", () => {
  it("HelpLink is a small ? link to the exact answer, with a name for screen readers", async () => {
    const Stub = createRoutesStub([
      { path: "/x", Component: () => <HelpLink topic="access-pin-album" /> },
    ]);
    render(<Stub initialEntries={["/x"]} />);
    const a = await screen.findByRole("link", { name: es["admin.help.link"] });
    expect(a.getAttribute("href")).toBe("/admin/ayuda#access-pin-album");
    expect(a.textContent).toBe("?");
  });

  it("an editor section shows its ? link only when it has a help topic", async () => {
    const Stub = createRoutesStub([
      {
        path: "/x",
        Component: () => (
          <>
            <Section title="Con ayuda" help="access-pin-album">
              <p>a</p>
            </Section>
            <Section title="Sin ayuda">
              <p>b</p>
            </Section>
          </>
        ),
      },
    ]);
    render(<Stub initialEntries={["/x"]} />);
    await screen.findByText("Con ayuda");
    expect(screen.getAllByRole("link").length).toBe(1);
  });

  it("the admin menu has an Ayuda entry to /admin/ayuda", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin/ayuda",
        Component: () => (
          <AdminShell
            status={{
              mock: false,
              connected: true,
              lastSyncAt: null,
              lastError: null,
            }}
          >
            x
          </AdminShell>
        ),
      },
    ]);
    render(<Stub initialEntries={["/admin/ayuda"]} />);
    const a = await screen.findByRole("link", { name: es["admin.nav.help"] });
    expect(a.getAttribute("href")).toBe("/admin/ayuda");
    cleanup();
  });
});
