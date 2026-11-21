import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { createRoutesStub, Outlet } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GalleryEditView,
  type GalleryEditData,
} from "../../app/components/admin/GalleryEditView";
import { coverSrc } from "../../app/components/admin/LivePreview";
import { fieldErrorsOf } from "../../app/components/admin/gallery-edit/field-errors";
import { useCoverPrefetch } from "../../app/components/admin/gallery-edit/useCoverPrefetch";
import { useDesignDraft } from "../../app/components/admin/gallery-edit/useDesignDraft";
import { allMessages } from "../../app/i18n/dictionaries";
import type { Design } from "../../app/lib/design";

/**
 * Mutation coverage of the gallery-edit/ split: each test pins one line of
 * the extracted modules that the characterization suite left unguarded.
 */

const gallery = {
  id: "g1",
  title: "Boda Ana",
  slug: "boda-ana",
  clientName: "Ana",
  eventDate: "2026-11-01",
  expires: null,
  status: "published",
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
};
const baseData = {
  gallery,
  deleting: false,
  hasWmFiles: false,
  hasThumbWmFiles: false,
  photoCount: 1,
  wmCount: 0,
  photos: [{ id: "p1", set: "A", name: "IMG_1", takenAt: null }],
  version: "v1",
  issues: { groups: [], truncated: 0, total: 0 },
};

let posted: [string, string][][] = [];

function Root({ children }: { children?: never }) {
  void children;
  return <Outlet />;
}

/** Router + i18n shell around `element` at /admin/g/g1. */
function mount(
  element: React.ReactElement,
  opts: { hang?: boolean; tab?: string } = {},
) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang: "es",
        messages: allMessages("es"),
        studioName: "Estudio",
      }),
      Component: Root,
      children: [
        {
          path: "admin/g/g1",
          action: async ({ request }) => {
            const fd = await request.formData();
            posted.push([...fd.entries()].map(([k, v]) => [k, String(v)]));
            if (opts.hang) await new Promise(() => {});
            return null;
          },
          Component: () => element,
        },
      ],
    },
  ]);
  return render(
    <Stub
      initialEntries={[`/admin/g/g1${opts.tab ? `?tab=${opts.tab}` : ""}`]}
    />,
  );
}

const view = (g: Partial<typeof gallery> = {}, origin?: string) => (
  <GalleryEditView
    data={
      {
        ...baseData,
        gallery: { ...gallery, ...g },
      } as unknown as GalleryEditData
    }
    origin={origin}
    actionData={undefined}
  />
);

beforeEach(() => {
  window.confirm = () => true;
});
afterEach(() => {
  posted = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const A: Design = {
  palette: "claro",
  coverLayout: "completa",
  gridStyle: "filas",
  gridGap: "normal",
};
const B: Design = { ...A, palette: "oscuro" };
const C: Design = { ...A, gridGap: "amplio" } as Design;

describe("gallery editor mutants: useDesignDraft", () => {
  type Hook = ReturnType<typeof useDesignDraft>;
  function harness(initial: Design) {
    const out: { hook?: Hook; setSaved?: (d: Design) => void } = {};
    const Probe = ({ saved }: { saved: Design }) => {
      const hook = useDesignDraft(saved);
      useEffect(() => {
        out.hook = hook;
      });
      return null;
    };
    // The saved design lives in a wrapper so the test can "reload" it.
    const Wrapper = () => {
      const [saved, setSaved] = useState(initial);
      useEffect(() => {
        out.setSaved = setSaved;
      }, [setSaved]);
      return <Probe saved={saved} />;
    };
    mount(<Wrapper />);
    return out;
  }

  async function ready(out: ReturnType<typeof harness>) {
    await waitFor(() => expect(out.hook && out.setSaved).toBeTruthy());
  }

  function fireUnload() {
    const ev = new Event("beforeunload", { cancelable: true });
    const setter = vi.fn();
    Object.defineProperty(ev, "returnValue", {
      set: setter,
      get: () => undefined,
      configurable: true,
    });
    window.dispatchEvent(ev);
    return { ev, setter };
  }

  it("a saved design coming back becomes the new baseline: draft replaced, clean, no leave guard", async () => {
    const out = harness(A);
    await ready(out);
    act(() => out.hook!.setDesign(B));
    expect(out.hook!.dirty).toBe(true);
    expect(fireUnload().ev.defaultPrevented).toBe(true);

    act(() => out.setSaved!(C));
    expect(out.hook!.design).toEqual(C);
    expect(out.hook!.dirty).toBe(false);
    expect(fireUnload().ev.defaultPrevented).toBe(false);
  });

  it("a saved design arriving while clean replaces the draft too", async () => {
    const out = harness(A);
    await ready(out);
    act(() => out.setSaved!(B));
    expect(out.hook!.design).toEqual(B);
    expect(out.hook!.dirty).toBe(false);
  });

  it("the beforeunload handler cancels the event and sets an empty returnValue", async () => {
    const out = harness(A);
    await ready(out);
    act(() => out.hook!.setDesign(B));
    const { ev, setter } = fireUnload();
    expect(ev.defaultPrevented).toBe(true);
    expect(setter).toHaveBeenCalledWith("");
  });

  it("discard goes back to the saved design", async () => {
    const out = harness(A);
    await ready(out);
    act(() => out.hook!.setDesign(B));
    act(() => out.hook!.discard());
    expect(out.hook!.design).toEqual(A);
    expect(out.hook!.dirty).toBe(false);
  });
});

describe("gallery editor mutants: sections", () => {
  it("a slug that only differs by case is not a change (no confirm)", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mount(view());
    await screen.findByRole("heading", { level: 1 });
    const slug = screen.getByLabelText("Dirección web");
    await user.clear(slug);
    await user.type(slug, "  BODA-Ana ");
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("Quitar PIN is disabled while a submit is in flight", async () => {
    const user = userEvent.setup();
    mount(view({ hasPin: true }), { hang: true });
    await screen.findByRole("heading", { level: 1 });
    const remove = screen.getByRole("button", {
      name: "Quitar PIN",
    }) as HTMLButtonElement;
    expect(remove.disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(remove.disabled).toBe(true));
    expect(
      (screen.getByRole("button", { name: "Cambiar PIN" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("the design bar pins to the bottom on phones only while there are unsaved changes", async () => {
    const user = userEvent.setup();
    mount(view(), { tab: "diseno" });
    await screen.findByRole("heading", { level: 1 });
    const bar = () =>
      screen.getByRole("button", { name: "Guardar diseño" })
        .parentElement as HTMLElement;
    const clean = bar();
    expect(clean.className).not.toContain("max-lg:");
    await user.click(screen.getByRole("radio", { name: /Oscuro/ }));
    for (const c of [
      "max-lg:fixed",
      "max-lg:inset-x-0",
      "max-lg:bottom-0",
      "max-lg:z-20",
      "max-lg:px-4",
      "max-lg:pb-3",
    ])
      expect(bar().className.split(/\s+/)).toContain(c);
    await user.click(screen.getByRole("button", { name: "Descartar" }));
    expect(bar().className).not.toContain("max-lg:");
  });

  it("the share URL starts from the origin prop, not the window", async () => {
    mount(view({}, "https://prop.test"), { tab: "compartir" });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByDisplayValue("https://prop.test/boda-ana")).toBeTruthy();
    expect(
      screen.queryByDisplayValue(`${window.location.origin}/boda-ana`),
    ).toBeNull();
  });
});

describe("gallery editor mutants: helpers", () => {
  it("fieldErrorsOf only returns errors of a failed action of the same intent", () => {
    const errs = { title: "x" };
    const act = (o: object) => o as never;
    expect(
      fieldErrorsOf(
        act({ intent: "details", ok: false, fieldErrors: errs }),
        "details",
      ),
    ).toEqual(errs);
    expect(
      fieldErrorsOf(
        act({ intent: "details", ok: true, fieldErrors: errs }),
        "details",
      ),
    ).toEqual({});
    expect(
      fieldErrorsOf(
        act({ intent: "pin", ok: false, fieldErrors: errs }),
        "details",
      ),
    ).toEqual({});
    expect(
      fieldErrorsOf(act({ intent: "details", ok: false }), "details"),
    ).toEqual({});
    expect(fieldErrorsOf(undefined, "details")).toEqual({});
  });

  it("a chosen cover prefetches both the previewed and the clean variant", () => {
    const srcs: string[] = [];
    vi.stubGlobal(
      "Image",
      class {
        set src(v: string) {
          srcs.push(v);
        }
      },
    );
    renderHook(() =>
      useCoverPrefetch({ photoId: "p9" } as never, {
        proofing: true,
        versions: { p9: "v7" },
      }),
    );
    expect(srcs).toEqual([
      coverSrc("p9", true, "v7"),
      coverSrc("p9", false, "v7"),
    ]);
    expect(srcs[0]).not.toBe(srcs[1]);
  });

  it("nothing is prefetched without a chosen photo", () => {
    const srcs: string[] = [];
    vi.stubGlobal(
      "Image",
      class {
        set src(v: string) {
          srcs.push(v);
        }
      },
    );
    renderHook(() => useCoverPrefetch(null, { proofing: false, versions: {} }));
    expect(srcs).toEqual([]);
  });
});
