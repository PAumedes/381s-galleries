import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, Outlet } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GalleryEditView,
  type GalleryEditData,
} from "../../app/components/admin/GalleryEditView";
import { allMessages } from "../../app/i18n/dictionaries";
import type { Lang } from "../../app/i18n/lang";

/**
 * Characterization of the gallery editor (GalleryEditView): pins what each
 * section renders and posts, plus a normalised DOM snapshot per state. It
 * exists so the component can be split into section components without any
 * accidental change in markup, field names, intents or ids.
 */

const base: GalleryEditData = {
  gallery: {
    id: "g1",
    title: "Boda Ana",
    slug: "boda-ana",
    clientName: "Ana",
    eventDate: "2026-11-01",
    expires: { date: "2026-12-24", time: "18:30" },
    status: "draft",
    allowHighres: true,
    allowWeb: true,
    allowIg: false,
    allowBulk: true,
    requireEmail: true,
    mode: "delivery" as const,
    palette: "claro" as const,
    coverLayout: "completa" as const,
    gridStyle: "filas" as const,
    gridGap: "normal" as const,
    hasPin: false,
    showOnHome: false,
    coverPhotoId: "p1",
    coverFocus: null,
  },
  deleting: false,
  hasWmFiles: false,
  hasThumbWmFiles: false,
  photoCount: 3,
  wmCount: 0,
  photos: [
    { id: "p1", set: "Highlights", name: "IMG_1", takenAt: null },
    { id: "p2", set: "Highlights", name: "IMG_2", takenAt: null },
    { id: "p3", set: "Fiesta", name: "IMG_3", takenAt: null },
  ],
  version: "v1",
  issues: {
    groups: [
      {
        type: "missing_web",
        label: "Falta la versión web",
        items: [{ set: "Fiesta", name: "IMG_9" }],
      },
    ],
    truncated: 2,
    total: 3,
  },
} as unknown as GalleryEditData;

type Entries = [string, string][];
let posted: Entries[] = [];

type Opts = {
  data?: Partial<GalleryEditData>;
  gallery?: Partial<GalleryEditData["gallery"]>;
  actionData?: unknown;
  tab?: string;
  lang?: Lang;
  origin?: string;
  /** Action never answers: the editor stays in the submitting state. */
  hang?: boolean;
};

function show(o: Opts = {}) {
  const lang = o.lang ?? "es";
  const data = {
    ...base,
    ...o.data,
    gallery: { ...base.gallery, ...o.gallery },
  } as GalleryEditData;
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang,
        messages: allMessages(lang),
        studioName: "Estudio",
      }),
      Component: () => <Outlet />,
      children: [
        {
          path: "admin/g/g1",
          action: async ({ request }) => {
            const fd = await request.formData();
            posted.push([...fd.entries()].map(([k, v]) => [k, String(v)]));
            if (o.hang) await new Promise(() => {});
            return null;
          },
          Component: () => (
            <GalleryEditView
              data={data}
              origin={o.origin ?? "https://galleries.test"}
              actionData={o.actionData as never}
            />
          ),
        },
      ],
    },
  ]);
  const url = `/admin/g/g1${o.tab ? `?tab=${o.tab}` : ""}`;
  return render(<Stub initialEntries={[url]} />);
}

async function ready() {
  await screen.findByRole("heading", { level: 1 });
  // Let async children (QR code) settle.
  await new Promise((r) => setTimeout(r, 30));
}

/** Outer HTML with generated ids replaced by ordinals (relations kept). */
function normalised(): string {
  const seen = new Map<string, string>();
  return document.body.innerHTML
    .replace(/(_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:)/g, (m) => {
      if (!seen.has(m)) seen.set(m, `ID${seen.size + 1}`);
      return seen.get(m)!;
    })
    .replace(/></g, ">\n<");
}

// happy-dom has no window.confirm: install a stub we can spy on.
beforeEach(() => {
  window.confirm = () => true;
});

afterEach(() => {
  posted = [];
  vi.restoreAllMocks();
});

const f = (name: string) => posted[0]?.filter(([k]) => k === name);

describe("gallery editor characterization: snapshots per state", () => {
  const states: [string, Opts][] = [
    ["datos draft es", {}],
    ["datos published es", { gallery: { status: "published" } }],
    ["datos archived es", { gallery: { status: "archived" } }],
    [
      "datos published with pin and home on",
      { gallery: { status: "published", hasPin: true, showOnHome: true } },
    ],
    [
      "datos published home on, no pin",
      { gallery: { status: "published", showOnHome: true } },
    ],
    [
      "datos no expiry, no client",
      {
        gallery: { expires: null, clientName: null, eventDate: null },
      },
    ],
    [
      "datos proofing, no preview-wm",
      { gallery: { mode: "proofing" }, data: { wmCount: 0, photoCount: 3 } },
    ],
    [
      "datos proofing, some preview-wm",
      { gallery: { mode: "proofing" }, data: { wmCount: 1, photoCount: 3 } },
    ],
    [
      "datos proofing, all preview-wm, home reminder, no thumb",
      {
        gallery: { mode: "proofing", showOnHome: true },
        data: { wmCount: 3, photoCount: 3, hasWmFiles: true },
      },
    ],
    [
      "datos proofing, home reminder and no wm",
      {
        gallery: { mode: "proofing", showOnHome: true },
        data: { wmCount: 0, photoCount: 3 },
      },
    ],
    ["datos deleting", { data: { deleting: true } }],
    [
      "datos field errors",
      {
        actionData: {
          intent: "details",
          ok: false,
          error: "bad",
          fieldErrors: {
            title: "Título requerido",
            slug: "Slug ocupado",
            expires: "Fecha inválida",
          },
        },
      },
    ],
    [
      "datos pin error + flags error",
      {
        actionData: {
          intent: "pin",
          ok: false,
          error: "PIN corto",
          fieldErrors: { pin: "PIN corto" },
        },
      },
    ],
    [
      "datos ok feedback on status",
      { actionData: { intent: "status", ok: true, message: "Publicada" } },
    ],
    [
      "datos delete continuing",
      { actionData: { intent: "delete", ok: true, continuing: true } },
    ],
    ["datos en", { lang: "en" }],
    ["fotos es", { tab: "fotos" }],
    [
      "fotos empty",
      {
        tab: "fotos",
        data: {
          photos: [] as never,
          issues: { groups: [], truncated: 0, total: 0 },
        },
      },
    ],
    ["fotos en", { tab: "fotos", lang: "en" }],
    ["portada es", { tab: "portada" }],
    ["portada proofing", { tab: "portada", gallery: { mode: "proofing" } }],
    ["diseno es", { tab: "diseno" }],
    ["diseno en", { tab: "diseno", lang: "en" }],
    [
      "diseno field errors",
      {
        tab: "diseno",
        actionData: {
          intent: "design",
          ok: false,
          error: "x",
          fieldErrors: { palette: "Paleta inválida" },
        },
      },
    ],
    ["compartir draft es", { tab: "compartir" }],
    [
      "compartir published pin en",
      {
        tab: "compartir",
        lang: "en",
        gallery: { status: "published", hasPin: true },
      },
    ],
    ["unknown tab falls back to datos", { tab: "nope" }],
  ];
  for (const [name, o] of states)
    it(`renders ${name}`, async () => {
      show(o);
      await ready();
      expect(normalised()).toMatchSnapshot();
    });

  it("pending state (submitting) disables the buttons", async () => {
    const user = userEvent.setup();
    show({ hang: true, gallery: { status: "published", hasPin: false } });
    await ready();
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Guardar datos",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
    expect(normalised()).toMatchSnapshot();
  });
});

describe("gallery editor characterization: header and tabs", () => {
  it("shows title, status pill, back link and preview link", async () => {
    show({ gallery: { status: "published" } });
    await ready();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Boda Ana",
    );
    expect(
      screen.getByRole("link", { name: "← Galerías" }).getAttribute("href"),
    ).toBe("/admin");
    const pv = screen.getByRole("link", { name: /Vista previa/ });
    expect(pv.getAttribute("href")).toBe("/admin/g/g1/preview?device=desktop");
    expect(pv.getAttribute("target")).toBe("_blank");
    expect(pv.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("the English header", async () => {
    show({ lang: "en" });
    await ready();
    expect(screen.getByRole("link", { name: /Preview/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save details" })).toBeTruthy();
  });

  it("only the active tab's sections render", async () => {
    show({ tab: "fotos" });
    await ready();
    expect(screen.queryByRole("button", { name: "Guardar datos" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Fotos" })).toBeTruthy();
  });
});

describe("gallery editor characterization: details", () => {
  it("posts intent=details with every field", async () => {
    const user = userEvent.setup();
    show();
    await ready();
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toEqual([
      ["intent", "details"],
      ["title", "Boda Ana"],
      ["slug", "boda-ana"],
      ["clientName", "Ana"],
      ["eventDate", "2026-11-01"],
      ["expiresDate", "2026-12-24"],
      ["expiresTime", "18:30"],
    ]);
  });

  it("unset expiry posts empty date and time", async () => {
    const user = userEvent.setup();
    show({ gallery: { expires: null } });
    await ready();
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(f("expiresDate")).toEqual([["expiresDate", ""]]);
    expect(f("expiresTime")).toEqual([["expiresTime", ""]]);
  });

  it("changing the slug asks to confirm; cancelling blocks the post", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    show();
    await ready();
    const slug = screen.getByLabelText("Slug");
    await user.clear(slug);
    await user.type(slug, "Nueva-Boda");
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(posted.length).toBe(0);
  });

  it("accepting the slug confirmation posts", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    show();
    await ready();
    const slug = screen.getByLabelText("Slug");
    await user.clear(slug);
    await user.type(slug, "nueva");
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(f("slug")).toEqual([["slug", "nueva"]]);
  });

  it("an unchanged slug (case/space aside) does not ask", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    show();
    await ready();
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("title and date edits are controlled and posted", async () => {
    const user = userEvent.setup();
    show();
    await ready();
    const title = screen.getByLabelText("Título");
    await user.clear(title);
    await user.type(title, "Otra");
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(f("title")).toEqual([["title", "Otra"]]);
  });

  it("field errors set aria-invalid and aria-describedby, expiry errors both inputs", async () => {
    show({
      actionData: {
        intent: "details",
        ok: false,
        error: "x",
        fieldErrors: { title: "T mal", expires: "E mal" },
      },
    });
    await ready();
    const title = screen.getByLabelText("Título");
    expect(title.getAttribute("aria-invalid")).toBe("true");
    const err = document.getElementById(
      title.getAttribute("aria-describedby")!,
    )!;
    expect(err.textContent).toBe("T mal");
    expect(
      screen.getByLabelText("Vence (fecha)").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      screen.getByLabelText("Vence (hora)").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(screen.getByText("E mal").getAttribute("role")).toBe("alert");
    expect(
      screen.getByLabelText("Vence (fecha)").getAttribute("aria-describedby"),
    ).toBe("expires-note");
  });

  it("constraints", async () => {
    show();
    await ready();
    expect(screen.getByLabelText("Título").getAttribute("maxlength")).toBe(
      "120",
    );
    expect(screen.getByLabelText("Slug").getAttribute("maxlength")).toBe("60");
    expect(screen.getByLabelText("Slug").hasAttribute("required")).toBe(true);
  });
});

describe("gallery editor characterization: status", () => {
  const buttons = (): string[] =>
    within(screen.getByRole("heading", { name: "Estado" }).closest("section")!)
      .getAllByRole("button")
      .map((b) => b.textContent!);

  it.each([
    ["draft", ["Publicar", "Archivar"]],
    ["published", ["Pasar a borrador", "Archivar"]],
    ["archived", ["Restaurar"]],
  ] as const)("%s offers %j", async (status, labels) => {
    show({ gallery: { status } });
    await ready();
    expect(buttons()).toEqual(labels);
  });

  it.each([
    ["Publicar", "publish", "draft"],
    ["Archivar", "archive", "draft"],
    ["Pasar a borrador", "draft", "published"],
    ["Restaurar", "restore", "archived"],
  ] as const)("%s posts intent=status to=%s", async (label, to, status) => {
    const user = userEvent.setup();
    show({ gallery: { status } });
    await ready();
    await user.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toEqual([
      ["intent", "status"],
      ["to", to],
    ]);
  });

  it("only publish is the primary button", async () => {
    show();
    await ready();
    expect(
      screen.getByRole("button", { name: "Publicar" }).className,
    ).toContain("bg-ink");
    expect(
      screen.getByRole("button", { name: "Archivar" }).className,
    ).not.toContain("bg-ink");
  });
});

describe("gallery editor characterization: pin", () => {
  it("unset: save button, no remove", async () => {
    show();
    await ready();
    expect(screen.getByText("Sin PIN")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar PIN" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Quitar PIN" })).toBeNull();
  });

  it("set: change + remove", async () => {
    show({ gallery: { hasPin: true } });
    await ready();
    expect(screen.getByRole("button", { name: "Cambiar PIN" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quitar PIN" })).toBeTruthy();
  });

  it("posts mode=set with the pin; remove posts mode=remove", async () => {
    const user = userEvent.setup();
    show({ gallery: { hasPin: true } });
    await ready();
    const pin = screen.getByLabelText("Nuevo PIN");
    expect(pin.getAttribute("type")).toBe("password");
    expect(pin.getAttribute("minlength")).toBe("6");
    expect(pin.getAttribute("maxlength")).toBe("32");
    expect(pin.getAttribute("autocomplete")).toBe("new-password");
    await user.type(pin, "123456");
    await user.click(screen.getByRole("button", { name: "Cambiar PIN" }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toEqual([
      ["intent", "pin"],
      ["mode", "set"],
      ["pin", "123456"],
    ]);
    await user.click(screen.getByRole("button", { name: "Quitar PIN" }));
    await waitFor(() => expect(posted.length).toBe(2));
    expect(posted[1]).toEqual([
      ["intent", "pin"],
      ["mode", "remove"],
    ]);
  });

  it("shows the pin error", async () => {
    show({
      actionData: {
        intent: "pin",
        ok: false,
        error: "x",
        fieldErrors: { pin: "PIN corto" },
      },
    });
    await ready();
    expect(
      screen.getByLabelText("Nuevo PIN").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(screen.getByText("PIN corto").getAttribute("role")).toBe("alert");
  });
});

describe("gallery editor characterization: home toggle", () => {
  const box = () =>
    screen.getByRole("checkbox", {
      name: "Mostrar en la portada",
    }) as HTMLInputElement;

  it("draft: disabled with the unpublished hint", async () => {
    show();
    await ready();
    expect(box().disabled).toBe(true);
    expect(box().id).toBe("show-on-home");
    expect(box().getAttribute("aria-describedby")).toBe("show-on-home-hint");
    expect(document.getElementById("show-on-home-hint")!.textContent).toMatch(
      /publica/i,
    );
  });

  it("published without pin: enabled; posts showOnHome 0 then 1", async () => {
    const user = userEvent.setup();
    show({ gallery: { status: "published" } });
    await ready();
    expect(box().disabled).toBe(false);
    expect(box().checked).toBe(false);
    await user.click(box());
    await user.click(
      screen
        .getAllByRole("button", { name: /^Guardar/ })
        .find((b) =>
          b.closest("form")?.querySelector("[name=intent][value=home]"),
        )!,
    );
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toEqual([
      ["intent", "home"],
      ["showOnHome", "0"],
      ["showOnHome", "1"],
    ]);
  });

  it("published and on: checked, unchecked posts only the 0", async () => {
    const user = userEvent.setup();
    show({ gallery: { status: "published", showOnHome: true } });
    await ready();
    expect(box().checked).toBe(true);
    await user.click(box());
    await user.click(
      screen
        .getAllByRole("button", { name: /^Guardar/ })
        .find((b) =>
          b.closest("form")?.querySelector("[name=intent][value=home]"),
        )!,
    );
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toEqual([
      ["intent", "home"],
      ["showOnHome", "0"],
    ]);
  });

  it("with a pin: disabled with the pin hint", async () => {
    show({ gallery: { status: "published", hasPin: true } });
    await ready();
    expect(box().disabled).toBe(true);
    expect(document.getElementById("show-on-home-hint")!.textContent).toMatch(
      /PIN/,
    );
  });
});

describe("gallery editor characterization: options and proofing warnings", () => {
  const status = () =>
    screen.queryAllByRole("status").map((s) => s.textContent);
  const radio = (v: string) =>
    document.querySelector(`input[name=mode][value=${v}]`) as HTMLInputElement;
  const allow = (n: string) =>
    document.querySelector(`input[name=${n}]`) as HTMLInputElement;

  it("delivery: allow options enabled with saved values, no warnings", async () => {
    show();
    await ready();
    expect(radio("delivery").checked).toBe(true);
    expect(radio("delivery").id).toBe("mode-delivery");
    expect(radio("proofing").id).toBe("mode-proofing");
    expect(allow("allowHighres").checked).toBe(true);
    expect(allow("allowIg").checked).toBe(false);
    for (const n of ["allowHighres", "allowWeb", "allowIg", "allowBulk"])
      expect(allow(n).disabled).toBe(false);
    expect(allow("requireEmail").checked).toBe(true);
    expect(status()).toEqual([]);
  });

  it("proofing with no preview-wm warns with the count", async () => {
    show({ gallery: { mode: "proofing" } });
    await ready();
    expect(radio("proofing").checked).toBe(true);
    for (const n of ["allowHighres", "allowWeb", "allowIg", "allowBulk"])
      expect(allow(n).disabled).toBe(true);
    expect(allow("requireEmail").disabled).toBe(false);
    expect(status().filter((s) => s?.includes("3"))).toHaveLength(1);
    expect(status()).toHaveLength(1);
  });

  it("proofing with some preview-wm warns with the missing count", async () => {
    show({ gallery: { mode: "proofing" }, data: { wmCount: 1 } });
    await ready();
    const s = status();
    expect(s).toHaveLength(1);
    expect(s[0]).toMatch(/2/);
    expect(s[0]).toMatch(/3/);
  });

  it("proofing with all preview-wm: no count warning", async () => {
    show({ gallery: { mode: "proofing" }, data: { wmCount: 3 } });
    await ready();
    expect(status()).toEqual([]);
  });

  it("proofing with no photos: no count warning", async () => {
    show({
      gallery: { mode: "proofing" },
      data: { photoCount: 0, photos: [] as never },
    });
    await ready();
    expect(status()).toEqual([]);
  });

  it("proofing on the home adds the reminder (and needs-wm when none)", async () => {
    show({ gallery: { mode: "proofing", showOnHome: true } });
    await ready();
    const s = status();
    expect(s).toHaveLength(2);
    expect(s.join(" ")).toMatch(/portada/i);
  });

  it("thumb-wm warning only with wm files but no thumbs", async () => {
    show({
      gallery: { mode: "proofing" },
      data: { wmCount: 3, hasWmFiles: true, hasThumbWmFiles: false },
    });
    await ready();
    expect(status()).toHaveLength(1);
    expect(screen.getByText(/miniatura/i)).toBeTruthy();
  });

  it("the Modo radio is live: switching to proofing shows warnings and disables allows", async () => {
    const user = userEvent.setup();
    show();
    await ready();
    await user.click(radio("proofing"));
    expect(status()).toHaveLength(1);
    expect(allow("allowWeb").disabled).toBe(true);
    await user.click(radio("delivery"));
    expect(status()).toEqual([]);
    expect(allow("allowWeb").disabled).toBe(false);
  });

  it("posts intent=flags with mode and the enabled checkboxes", async () => {
    const user = userEvent.setup();
    show();
    await ready();
    const form = radio("delivery").closest("form")!;
    await user.click(within(form).getByRole("button", { name: /^Guardar/ }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toEqual([
      ["intent", "flags"],
      ["mode", "delivery"],
      ["allowHighres", "1"],
      ["allowWeb", "1"],
      ["allowBulk", "1"],
      ["requireEmail", "1"],
    ]);
  });

  it("posts proofing without the disabled allows", async () => {
    const user = userEvent.setup();
    show({ gallery: { mode: "proofing" } });
    await ready();
    const form = radio("delivery").closest("form")!;
    await user.click(within(form).getByRole("button", { name: /^Guardar/ }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toEqual([
      ["intent", "flags"],
      ["mode", "proofing"],
      ["requireEmail", "1"],
    ]);
  });

  it("shows the mode field error", async () => {
    show({
      actionData: {
        intent: "flags",
        ok: false,
        error: "x",
        fieldErrors: { mode: "Modo inválido" },
      },
    });
    await ready();
    expect(screen.getByText("Modo inválido").getAttribute("role")).toBe(
      "alert",
    );
  });
});

describe("gallery editor characterization: danger zone", () => {
  it("posts intent=delete with the typed slug after confirm", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    show();
    await ready();
    const input = screen.getByLabelText(/boda-ana/);
    expect(input.getAttribute("name")).toBe("slug");
    expect(input.hasAttribute("required")).toBe(true);
    await user.type(input, "boda-ana");
    await user.click(screen.getByRole("button", { name: "Eliminar galería" }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(posted[0]).toEqual([
      ["intent", "delete"],
      ["slug", "boda-ana"],
    ]);
  });

  it("cancelling the confirm blocks the post", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    show();
    await ready();
    await user.type(screen.getByLabelText(/boda-ana/), "boda-ana");
    await user.click(screen.getByRole("button", { name: "Eliminar galería" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(posted.length).toBe(0);
  });

  it("deleting / continuing show the status note", async () => {
    show({ data: { deleting: true } });
    await ready();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("delete errors show next to the form", async () => {
    show({
      actionData: { intent: "delete", ok: false, error: "Slug no coincide" },
    });
    await ready();
    expect(screen.getByText("Slug no coincide").getAttribute("role")).toBe(
      "alert",
    );
  });
});

describe("gallery editor characterization: photos and issues", () => {
  it("lists issues with counts and the truncated note", async () => {
    show({ tab: "fotos" });
    await ready();
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(
      /\(1\)/,
    );
    expect(screen.getByText("Fiesta / IMG_9")).toBeTruthy();
    expect(screen.getByText(/2/, { selector: "p.text-grey-600" })).toBeTruthy();
  });

  it("unknown issue types fall back to the generic label", async () => {
    show({
      tab: "fotos",
      data: {
        issues: {
          groups: [
            { type: "toString", label: "", items: [{ set: "", name: "x" }] },
          ],
          truncated: 0,
          total: 1,
        } as never,
      },
    });
    await ready();
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(
      "Otros avisos (1)",
    );
  });

  it("no issues and no photos show the empty notes", async () => {
    show({
      tab: "fotos",
      data: {
        photos: [] as never,
        issues: { groups: [], truncated: 0, total: 0 },
      },
    });
    await ready();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    expect(
      screen.getAllByText(/./, { selector: "p.text-small.text-grey-600" })
        .length,
    ).toBe(2);
  });

  it("cover feedback shows under the grid", async () => {
    show({
      tab: "fotos",
      actionData: { intent: "cover", ok: false, error: "Portada rota" },
    });
    await ready();
    expect(screen.getByText("Portada rota")).toBeTruthy();
  });

  it("choosing a cover posts intent=cover and shows it at once (optimistic)", async () => {
    const user = userEvent.setup();
    show({ tab: "fotos", hang: true });
    await ready();
    const pick = screen.getAllByRole("button", { name: /portada/i });
    expect(pick.length).toBeGreaterThan(0);
    await user.click(pick[pick.length - 1]!);
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]!.find(([k]) => k === "intent")).toEqual([
      "intent",
      "cover",
    ]);
  });
});

describe("gallery editor characterization: share", () => {
  it("builds the URL from origin + slug and exposes the card link", async () => {
    show({ tab: "compartir", origin: "https://x.test" });
    await ready();
    expect(
      (screen.getByDisplayValue("https://x.test/boda-ana") as HTMLInputElement)
        .readOnly,
    ).toBe(true);
    expect(document.querySelector('a[href="/admin/g/g1/card"]')).toBeTruthy();
  });

  it("falls back to window.location.origin without origin", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin/g/g1",
        Component: () => <GalleryEditView data={base} actionData={undefined} />,
      },
    ]);
    render(<Stub initialEntries={["/admin/g/g1?tab=compartir"]} />);
    await screen.findByRole("heading", { level: 1 });
    expect(
      screen.getByDisplayValue(`${window.location.origin}/boda-ana`),
    ).toBeTruthy();
  });

  it("renders a QR image", async () => {
    show({ tab: "compartir" });
    await ready();
    expect(document.querySelector("svg, img[src^='data:']")).toBeTruthy();
  });

  it("client view section links to the preview in a new tab", async () => {
    show({ tab: "compartir" });
    await ready();
    const a = screen.getByRole("link", { name: /Abrir/ });
    expect(a.getAttribute("href")).toBe(
      "/admin/g/g1/preview?device=desktop&tab=compartir",
    );
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("gallery editor characterization: design", () => {
  it("the form carries id/data attribute, the save button targets it and starts disabled", async () => {
    show({ tab: "diseno" });
    await ready();
    const form = document.querySelector("form[data-design-form]")!;
    expect(form.id).toBeTruthy();
    const save = screen.getByRole("button", {
      name: "Guardar diseño",
    }) as HTMLButtonElement;
    expect(save.getAttribute("form")).toBe(form.id);
    expect(save.disabled).toBe(true);
    expect(
      form.querySelector("input[name=intent]")!.getAttribute("value"),
    ).toBe("design");
  });

  it("changing the design enables save/discard and marks the tab unsaved; discard restores", async () => {
    const user = userEvent.setup();
    show({ tab: "diseno" });
    await ready();
    await user.click(screen.getByRole("radio", { name: /Oscuro/ }));
    const save = screen.getByRole("button", {
      name: "Guardar diseño",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Descartar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "Descartar" }));
    expect(save.disabled).toBe(true);
  });

  it("posts the design form", async () => {
    const user = userEvent.setup();
    show({ tab: "diseno" });
    await ready();
    await user.click(screen.getByRole("radio", { name: /Oscuro/ }));
    await user.click(screen.getByRole("button", { name: "Guardar diseño" }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]![0]).toEqual(["intent", "design"]);
    expect(posted[0]).toContainEqual(["palette", "oscuro"]);
  });

  it("dirty design registers a beforeunload warning", async () => {
    const user = userEvent.setup();
    const add = vi.spyOn(window, "addEventListener");
    show({ tab: "diseno" });
    await ready();
    await user.click(screen.getByRole("radio", { name: /Oscuro/ }));
    expect(add.mock.calls.some(([e]) => e === "beforeunload")).toBe(true);
  });
});
