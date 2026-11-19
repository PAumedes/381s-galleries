import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, Outlet } from "react-router";
import { describe, expect, it } from "vitest";
import { AdminShell } from "../../app/components/admin/AdminShell";
import {
  GalleryList,
  type GalleryListItem,
} from "../../app/components/admin/GalleryList";
import { allMessages } from "../../app/i18n/dictionaries";
import { en } from "../../app/i18n/en";
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
        studioName: "Estudio",
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

describe("admin shell on phones (T6.11)", () => {
  it("T6.22: the rendered logo link can shrink and clips a long studio name", async () => {
    shell();
    const mark = await waitFor(() => {
      const m = document.querySelector("a[href='/admin'] [data-logo=wordmark]");
      expect(m).not.toBeNull();
      return m!;
    });
    expect(mark.parentElement!.className).toMatch(/(^|\s)min-w-0(\s|$)/);
    expect(mark.parentElement!.className).toMatch(/overflow-hidden/);
  });
  it("has a menu toggle with aria-expanded/aria-controls that opens the panel", async () => {
    shell();
    const toggle = await screen.findByRole("button", {
      name: es["admin.nav.menu"],
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    );
    expect(panel).toBeTruthy();
    expect(panel!.className).toContain("hidden");
    expect(panel!.querySelector("nav")).toBeTruthy();

    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel!.className).not.toMatch(/(^|\s)hidden(\s|$)/);

    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the menu with Escape", async () => {
    shell();
    const toggle = await screen.findByRole("button", {
      name: es["admin.nav.menu"],
    });
    await userEvent.click(toggle);
    await userEvent.keyboard("{Escape}");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("translates the toggle label", () => {
    expect(en["admin.nav.menu"]).toBeTruthy();
    expect(es["admin.nav.menu"]).toBeTruthy();
  });
});

const row: GalleryListItem = {
  id: "g1",
  title: "Boda Ana",
  slug: "boda-ana",
  clientName: null,
  eventDate: "2026-11-01",
  status: "published",
  expiresAt: null,
  expired: false,
  coverPhotoId: "p1",
  photoCount: 120,
  views: 33,
  downloads: 7,
  issueCount: 0,
};

describe("gallery list rows on phones (T6.11)", () => {
  it("rows stack as cards below xl and label every cell", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin",
        Component: () => (
          <GalleryList galleries={[row]} filter="todas" total={1} />
        ),
      },
    ]);
    render(<Stub initialEntries={["/admin"]} />);
    const link = await screen.findByRole("link", { name: "Boda Ana" });
    const tr = link.closest("tr")!;
    expect(tr.className).toContain("grid");
    expect(tr.className).toContain("xl:table-row");
    const labelled = [...tr.querySelectorAll("td[data-label]")].map((td) =>
      td.getAttribute("data-label"),
    );
    expect(labelled).toEqual(
      expect.arrayContaining([
        es["admin.list.col.date"],
        es["admin.list.col.status"],
        es["admin.list.col.photos"],
        es["admin.list.col.views"],
        es["admin.list.col.downloads"],
        es["admin.list.col.expires"],
      ]),
    );
    // The table must not force a wide min-width on phones.
    expect(tr.closest("table")!.className).not.toMatch(/(^|\s)min-w-\[/);
  });
});
