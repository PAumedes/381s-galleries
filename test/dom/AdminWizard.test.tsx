import { readFileSync } from "node:fs";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { AdminShell } from "../../app/components/admin/AdminShell";
import { HelpView } from "../../app/components/admin/help/HelpView";
import { WizardBanner } from "../../app/components/admin/wizard/WizardBanner";
import { WizardView } from "../../app/components/admin/wizard/WizardView";
import { en } from "../../app/i18n/en";
import { setFallbackMessages } from "../../app/i18n/fallback";
import { es } from "../../app/i18n/es";
import type { WizardData } from "../../app/lib/server/admin-wizard";
import { HELP_SECTIONS } from "../../app/lib/help";
import { SYNC_INTERVAL_MINUTES } from "../../app/lib/server/sync-types";
import { makeT } from "../../app/i18n/t";
import {
  WIZARD_STEPS,
  wizardMetaTitle,
  wizardStates,
} from "../../app/lib/wizard";

// T6.58: the wizard on screen (Spanish by default).

const HELP_IDS = new Set(
  HELP_SECTIONS.flatMap((s) => s.items.map((i) => i.id)),
);

function data(
  over: Partial<WizardData> = {},
  facts?: Parameters<typeof wizardStates>[0],
): WizardData {
  const f = facts ?? {
    driveReady: false,
    clients: 0,
    galleries: 0,
    published: 0,
  };
  return {
    step: 1,
    states: wizardStates(f),
    mock: false,
    driveReady: f.driveReady,
    connected: f.driveReady,
    rootName: null,
    clients: f.clients,
    galleries: { count: f.galleries, published: f.published, recent: [] },
    target: null,
    ...over,
  };
}
const target = {
  id: "g1",
  title: "Boda de Ana",
  status: "draft" as const,
  mode: "delivery" as const,
  pin: false,
  downloads: true,
  expiresAt: null,
  url: "https://gallery.test/ana/boda",
  clientName: "Ana",
  clientUrl: "https://gallery.test/ana",
  clientPin: false,
};

function show(d: WizardData, actionData?: unknown) {
  const Stub = createRoutesStub([
    {
      path: "/admin/empezar",
      Component: () => <WizardView data={d} actionData={actionData as never} />,
    },
  ]);
  return render(<Stub initialEntries={["/admin/empezar"]} />);
}

afterEach(() => {
  cleanup();
  setFallbackMessages(es);
});

const hrefs = () =>
  [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));

describe("T6.58 WizardView: frame", () => {
  it("one h1, the progress as words, the step title as h2, a list of all six steps", async () => {
    show(data({ step: 3 }));
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
      es["admin.wizard.title"],
    );
    expect(screen.getByText("Paso 3 de 6")).toBeTruthy();
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .some((h) => h.textContent === es["admin.wizard.client.title"]),
    ).toBe(true);
    const nav = screen.getByRole("navigation", {
      name: es["admin.wizard.steps"],
    });
    const items = within(nav).getAllByRole("listitem");
    expect(items).toHaveLength(6);
    const current = nav.querySelector('[aria-current="step"]');
    expect(current?.getAttribute("href")).toBe("/admin/empezar?paso=3");
    // states are words, not only colour
    expect(items[0]!.textContent).toContain(es["admin.wizard.state.todo"]);
    expect(items[1]!.textContent).toContain(es["admin.wizard.state.read"]);
    expect(items[2]!.textContent).toContain(es["admin.wizard.state.optional"]);
  });

  it("Back is missing on step 1; Next on a read step; Skip on a not-done step; Finish on the last", async () => {
    show(data({ step: 1 }));
    expect(
      screen.queryByRole("link", { name: es["admin.wizard.back"] }),
    ).toBeNull();
    expect(
      screen
        .getByRole("link", { name: es["admin.wizard.skip"] })
        .getAttribute("href"),
    ).toBe("/admin/empezar?paso=2");
    expect(
      screen.queryByRole("link", { name: es["admin.wizard.next"] }),
    ).toBeNull();
    cleanup();
    show(data({ step: 2 }));
    expect(
      screen
        .getByRole("link", { name: es["admin.wizard.back"] })
        .getAttribute("href"),
    ).toBe("/admin/empezar?paso=1");
    expect(
      screen
        .getByRole("link", { name: es["admin.wizard.next"] })
        .getAttribute("href"),
    ).toBe("/admin/empezar?paso=3");
    cleanup();
    show(data({ step: 3 }));
    expect(
      screen
        .getByRole("link", { name: es["admin.wizard.skip"] })
        .getAttribute("href"),
    ).toBe("/admin/empezar?paso=4");
    cleanup();
    show(data({ step: 6 }));
    expect(
      screen
        .getByRole("link", { name: es["admin.wizard.finish"] })
        .getAttribute("href"),
    ).toBe("/admin");
    expect(
      screen.queryByRole("link", { name: es["admin.wizard.skip"] }),
    ).toBeNull();
  });

  it("a done step offers Next instead of Skip", async () => {
    show(
      data(
        { step: 1 },
        { driveReady: true, clients: 0, galleries: 0, published: 0 },
      ),
    );
    expect(
      screen.getByRole("link", { name: es["admin.wizard.next"] }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: es["admin.wizard.skip"] }),
    ).toBeNull();
  });

  it("every help link points to a real answer; every wizard link stays inside the admin", async () => {
    for (let step = 1; step <= 6; step++) {
      show(
        data({
          step,
          target,
          galleries: {
            count: 1,
            published: 0,
            recent: [{ id: "g1", title: "Boda", status: "draft" }],
          },
        }),
      );
      for (const h of hrefs()) {
        expect(h, `step ${step}`).toMatch(/^\/admin/);
        const m = /^\/admin\/ayuda#(.+)$/.exec(h!);
        if (m) expect(HELP_IDS.has(m[1]!), `${step} ${h}`).toBe(true);
      }
      cleanup();
    }
  });

  it("English renders too", async () => {
    setFallbackMessages(en);
    show(data({ step: 2 }));
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
      en["admin.wizard.title"],
    );
    expect(screen.getByText("Step 2 of 6")).toBeTruthy();
  });
});

describe("T6.58 WizardView: steps", () => {
  it("1 drive: not connected = connect link; connected = real names and folder", async () => {
    show(data({ step: 1 }));
    expect(hrefs()).toContain("/admin/google/connect");
    cleanup();
    show(
      data(
        { step: 1, rootName: "Sesiones", connected: true, driveReady: true },
        { driveReady: true, clients: 0, galleries: 0, published: 0 },
      ),
    );
    expect(document.body.textContent).toContain("Sesiones");
    expect(hrefs()).not.toContain("/admin/google/connect");
    expect(hrefs()).toContain("/admin/setup");
  });

  it("1 drive: demo mode has no connect link", async () => {
    show(
      data(
        { step: 1, mock: true, driveReady: true },
        { driveReady: true, clients: 0, galleries: 0, published: 0 },
      ),
    );
    expect(hrefs()).not.toContain("/admin/google/connect");
    expect(document.body.textContent).toContain(es["admin.setup.drive.demo"]);
  });

  it("2 folders: names the folders and links the help answers", async () => {
    show(data({ step: 2 }));
    expect(hrefs()).toContain("/admin/ayuda#drive-folders");
    expect(hrefs()).toContain("/admin/ayuda#drive-captureone");
  });

  it("3 client: one form to the wizard action, name field, no slug field; shows errors", async () => {
    show(data({ step: 3 }), {
      intent: "createClient",
      ok: false,
      error: "Revisá los campos.",
      fieldErrors: { name: "Escribí un nombre." },
    });
    const form = document.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/admin/empezar?paso=3");
    expect(
      (form.querySelector('[name="intent"]') as HTMLInputElement).value,
    ).toBe("createClient");
    const input = form.querySelector('input[name="name"]') as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(form.querySelector('[name="slug"]')).toBeNull();
    expect(document.body.textContent).toContain("Escribí un nombre.");
    expect(
      screen.getByRole("link", { name: es["admin.wizard.skip"] }),
    ).toBeTruthy();
  });

  it("3 client: with clients, says how many and links the list", async () => {
    show(
      data(
        { step: 3, clients: 2 },
        { driveReady: false, clients: 2, galleries: 0, published: 0 },
      ),
    );
    expect(hrefs()).toContain("/admin/clients");
  });

  it("4 gallery: sync form to the setup action, detected galleries link to their pages", async () => {
    show(
      data(
        {
          step: 4,
          galleries: {
            count: 1,
            published: 0,
            recent: [{ id: "g1", title: "Boda de Ana", status: "draft" }],
          },
          target,
        },
        { driveReady: true, clients: 0, galleries: 1, published: 0 },
      ),
    );
    const form = document.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/admin/setup");
    expect(
      (form.querySelector('[name="intent"]') as HTMLInputElement).value,
    ).toBe("sync");
    expect(within(form).getByRole("button").textContent).toBe(
      es["admin.setup.sync.now"],
    );
    expect(hrefs()).toContain("/admin/g/g1");
    expect(document.body.textContent).toContain("Boda de Ana");
  });

  it("4 gallery: without Drive there is no sync form, only a way back to step 1", async () => {
    show(data({ step: 4 }));
    expect(document.querySelector("form")).toBeNull();
    expect(hrefs()).toContain("/admin/empezar?paso=1");
  });

  it("5 settings: five lines with the real value and a help link each, and a link to the gallery", async () => {
    show(
      data(
        {
          step: 5,
          target: {
            ...target,
            pin: true,
            downloads: false,
            mode: "proofing",
            expiresAt: "2030-01-01T12:00:00.000Z",
          },
        },
        { driveReady: true, clients: 0, galleries: 1, published: 0 },
      ),
    );
    expect(hrefs()).toContain("/admin/g/g1");
    const helps = hrefs().filter((h) => h?.startsWith("/admin/ayuda#"));
    for (const id of [
      "albums-publish",
      "access-pin-album",
      "proof-modes",
      "proof-sizes",
      "albums-expiry",
    ])
      expect(helps).toContain(`/admin/ayuda#${id}`);
    const list = document.querySelector("ul[data-settings]")!;
    expect(list.querySelectorAll("li")).toHaveLength(5);
    const text = list.textContent!;
    expect(text).toContain(es["admin.state.draft"]);
    expect(text).toContain(es["admin.mode.proofing"]);
    expect(text).toContain(es["admin.wizard.val.pinOn"]);
    expect(text).toContain(es["admin.wizard.val.dlOff"]);
  });

  it("5 settings: no gallery yet says so and links back to step 4", async () => {
    show(data({ step: 5 }));
    expect(hrefs()).toContain("/admin/empezar?paso=4");
    expect(document.querySelector("ul[data-settings]")).toBeNull();
  });

  it("6 share: the real link in a read-only field, the client page link, a copy button", async () => {
    show(
      data(
        { step: 6, target: { ...target, status: "published" } },
        { driveReady: true, clients: 1, galleries: 1, published: 1 },
      ),
    );
    const fields = [
      ...document.querySelectorAll("input[readonly]"),
    ] as HTMLInputElement[];
    expect(fields.map((f) => f.value)).toEqual([
      "https://gallery.test/ana/boda",
      "https://gallery.test/ana",
    ]);
    for (const f of fields)
      expect(document.querySelector(`label[for="${f.id}"]`)).toBeTruthy();
    expect(
      await screen.findAllByRole("button", { name: es["admin.share.copy"] }),
    ).toHaveLength(2);
  });

  it("6 share: a draft says to publish first and offers no link and no copy button", async () => {
    show(data({ step: 6, target }));
    expect(document.body.textContent).toContain(es["admin.wizard.share.draft"]);
    expect(document.querySelector("input[readonly]")).toBeNull();
    expect(
      screen.queryByRole("button", { name: es["admin.share.copy"] }),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("gallery.test");
  });

  it("6 share: a PIN on the gallery or on its client adds a line to send it separately", async () => {
    const pub = { ...target, status: "published" as const };
    show(data({ step: 6, target: pub }));
    expect(document.body.textContent).not.toContain(
      es["admin.wizard.share.pin"],
    );
    cleanup();
    show(data({ step: 6, target: { ...pub, pin: true } }));
    expect(document.body.textContent).toContain(es["admin.wizard.share.pin"]);
    cleanup();
    show(data({ step: 6, target: { ...pub, clientPin: true } }));
    expect(document.body.textContent).toContain(
      es["admin.wizard.share.clientPin"],
    );
    cleanup();
    setFallbackMessages(en);
    show(data({ step: 6, target: { ...pub, pin: true } }));
    expect(document.body.textContent).toContain(en["admin.wizard.share.pin"]);
  });

  it("the step heading can take focus and carries the step title", async () => {
    for (let n = 1; n <= 6; n++) {
      show(data({ step: n }));
      const h = document.querySelector("h2")!;
      expect(h.getAttribute("tabindex")).toBe("-1");
      expect(h.id).toBe(`wizard-${WIZARD_STEPS[n - 1]!.id}`);
      cleanup();
    }
  });

  it("each step has its own document title, in both languages", () => {
    for (const [lang, d] of [
      ["es", es],
      ["en", en],
    ] as const) {
      const t = makeT(lang, d);
      const titles = WIZARD_STEPS.map((_, i) => wizardMetaTitle(t, i + 1));
      expect(new Set(titles).size).toBe(6);
      for (const x of titles) expect(x).toContain(d["admin.meta.wizard"]);
    }
    expect(wizardMetaTitle(makeT("es", es), 99)).toBe(es["admin.meta.wizard"]);
  });

  it("6 share: no gallery, no link field", async () => {
    show(data({ step: 6 }));
    expect(document.querySelector("input[readonly]")).toBeNull();
    expect(hrefs()).toContain("/admin/empezar?paso=4");
  });

  it("never prints a Drive id or a token", async () => {
    show(data({ step: 6, target }));
    expect(document.body.innerHTML).not.toMatch(/drive-secret|refresh/i);
  });
});

describe("T6.58 entry points", () => {
  it("banner: a link to the wizard and a dismiss form that posts to it", async () => {
    const Stub = createRoutesStub([
      { path: "/admin", Component: () => <WizardBanner /> },
    ]);
    render(<Stub initialEntries={["/admin"]} />);
    const region = await screen.findByRole("region", {
      name: es["admin.wizard.banner.title"],
    });
    expect(
      within(region)
        .getByRole("link", { name: es["admin.wizard.banner.open"] })
        .getAttribute("href"),
    ).toBe("/admin/empezar");
    const form = region.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/admin/empezar");
    expect(
      (form.querySelector('[name="intent"]') as HTMLInputElement).value,
    ).toBe("dismiss");
    expect(within(form).getByRole("button").textContent).toBe(
      es["admin.wizard.banner.dismiss"],
    );
  });

  it("the admin menu has a link to the wizard", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin",
        Component: () => (
          <AdminShell
            status={{
              mock: false,
              connected: true,
              lastSyncAt: null,
              lastError: null,
            }}
          >
            <p>x</p>
          </AdminShell>
        ),
      },
    ]);
    render(<Stub initialEntries={["/admin"]} />);
    const nav = await screen.findByRole("navigation", {
      name: es["admin.nav.label"],
    });
    expect(
      within(nav)
        .getByRole("link", { name: es["admin.nav.wizard"] })
        .getAttribute("href"),
    ).toBe("/admin/empezar");
  });

  it("the help intro points to the wizard", async () => {
    const Stub = createRoutesStub([
      { path: "/admin/ayuda", Component: HelpView },
    ]);
    render(<Stub initialEntries={["/admin/ayuda"]} />);
    const link = await screen.findByRole("link", {
      name: es["admin.wizard.helpLink"],
    });
    expect(link.getAttribute("href")).toBe("/admin/empezar");
  });
});

describe("T6.58 the sync interval the wizard shows", () => {
  it("is the real cron of wrangler.jsonc", () => {
    expect(readFileSync("wrangler.jsonc", "utf8")).toContain(
      `"*/${SYNC_INTERVAL_MINUTES} * * * *"`,
    );
  });
});
