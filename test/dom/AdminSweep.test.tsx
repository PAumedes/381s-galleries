import { render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import {
  SetupView,
  type SetupViewData,
} from "../../app/components/admin/SetupView";

/** T6.59: the "Mantenimiento" section (orphan cache sweep) of the settings page. No real browser here. */
const base: SetupViewData = {
  connected: true,
  mock: false,
  rootName: "Root",
  studioName: "381 Studios",
  lastSyncAt: null,
  lastError: null,
};
const totals = (over: object = {}) => ({
  scanned: 2400,
  orphans: 0,
  bytes: 0,
  ignored: 0,
  held: 0,
  deleted: 0,
  ...over,
});
const sweep = (over: object = {}) => ({
  phase: "scan",
  totals: totals(),
  cursor: null,
  done: true,
  ...over,
});

function show(
  actionData?: unknown,
  onPost?: (f: FormData) => void,
  hang = false,
) {
  const Stub = createRoutesStub([
    {
      path: "/admin/setup",
      Component: () => (
        <SetupView data={base} actionData={actionData as never} />
      ),
      action: async ({ request }) => {
        onPost?.(await request.formData());
        if (hang) await new Promise(() => {});
        return { intent: "sweepScan", ok: true, sweep: sweep() };
      },
    },
  ]);
  return render(<Stub initialEntries={["/admin/setup"]} />);
}
const hidden = (form: HTMLElement, name: string) =>
  (form.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)
    ?.value;

describe("T6.59 Mantenimiento section", () => {
  it("starts with one scan button that posts the scan intent", async () => {
    show();
    expect(await screen.findByText("Mantenimiento")).toBeTruthy();
    const btn = screen.getByRole("button", {
      name: "Buscar archivos huérfanos",
    });
    expect(hidden(btn.closest("form")!, "intent")).toBe("sweepScan");
    expect(hidden(btn.closest("form")!, "cursor")).toBeUndefined();
    expect(
      screen.queryByRole("button", { name: /Borrar archivos/ }),
    ).toBeNull();
  });

  it("a running scan shows progress and a plain 'continue' form with the cursor and totals", async () => {
    show(
      {
        intent: "sweepScan",
        ok: true,
        sweep: sweep({
          cursor: "CUR1",
          done: false,
          totals: totals({ orphans: 4 }),
        }),
      },
      undefined,
      true,
    ); // the automatic next page is still in flight
    const btn = await screen.findByRole("button", { name: "Seguir buscando" });
    const form = btn.closest("form")!;
    expect(hidden(form, "intent")).toBe("sweepScan");
    expect(hidden(form, "cursor")).toBe("CUR1");
    expect(JSON.parse(hidden(form, "totals")!)).toMatchObject({
      scanned: 2400,
      orphans: 4,
    });
    expect(screen.getByText(/2[.,]?400/)).toBeTruthy();
  });

  it("with scripts running it keeps going by itself until the cursor runs out", async () => {
    const posts: FormData[] = [];
    show(
      {
        intent: "sweepScan",
        ok: true,
        sweep: sweep({ cursor: "CUR1", done: false }),
      },
      (f) => posts.push(f),
    );
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].get("intent")).toBe("sweepScan");
    expect(posts[0].get("cursor")).toBe("CUR1");
    expect(JSON.parse(String(posts[0].get("totals"))).scanned).toBe(2400);
    // the answer has no cursor: it stops
    await new Promise((r) => setTimeout(r, 50));
    expect(posts.length).toBe(1);
  });

  it("a finished scan shows the totals and a delete form that needs a ticked confirmation", async () => {
    show({
      intent: "sweepScan",
      ok: true,
      sweep: sweep({
        totals: totals({
          orphans: 12,
          bytes: 5 * 1024 * 1024,
          ignored: 3,
          held: 2,
        }),
      }),
    });
    const btn = await screen.findByRole("button", {
      name: "Borrar archivos huérfanos",
    });
    const form = btn.closest("form")!;
    expect(hidden(form, "intent")).toBe("sweepDelete");
    const box = form.querySelector(
      'input[type="checkbox"][name="confirm"]',
    ) as HTMLInputElement;
    expect(box.required).toBe(true);
    expect(box.value).toBe("1");
    const text = document.body.textContent ?? "";
    expect(text).toContain("12");
    expect(text).toContain("5 MB");
    expect(text).toMatch(/3/);
    expect(text).toMatch(/2/);
  });

  it("a finished scan with no orphans offers nothing to delete", async () => {
    show({ intent: "sweepScan", ok: true, sweep: sweep() });
    expect(await screen.findByText(/No hay archivos huérfanos/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Borrar archivos huérfanos" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Buscar archivos huérfanos" }),
    ).toBeTruthy();
  });

  it("a running delete continues with the confirmation already given", async () => {
    show(
      {
        intent: "sweepDelete",
        ok: true,
        sweep: sweep({
          phase: "delete",
          cursor: "C2",
          done: false,
          totals: totals({ deleted: 1000 }),
        }),
      },
      undefined,
      true,
    );
    const btn = await screen.findByRole("button", { name: "Seguir borrando" });
    const form = btn.closest("form")!;
    expect(hidden(form, "intent")).toBe("sweepDelete");
    expect(hidden(form, "confirm")).toBe("1");
    expect(hidden(form, "cursor")).toBe("C2");
  });

  it("a finished delete says how many files went", async () => {
    show({
      intent: "sweepDelete",
      ok: true,
      sweep: sweep({ phase: "delete", totals: totals({ deleted: 12 }) }),
    });
    expect(await screen.findByText(/se borraron 12/)).toBeTruthy();
  });

  it("an error is an alert with the generic text, and the work can be resumed", async () => {
    show({
      intent: "sweepScan",
      ok: false,
      error: "No se pudo completar la revisión. Probá de nuevo.",
      sweep: sweep({ cursor: "CUR9", done: false }),
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "No se pudo",
    );
    const form = screen
      .getByRole("button", { name: "Seguir buscando" })
      .closest("form")!;
    expect(hidden(form, "cursor")).toBe("CUR9");
  });

  it("an error does not retry by itself (no loop)", async () => {
    const posts: FormData[] = [];
    show(
      {
        intent: "sweepScan",
        ok: false,
        error: "x",
        sweep: sweep({ cursor: "CUR9", done: false }),
      },
      (f) => posts.push(f),
    );
    await screen.findByRole("alert");
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toEqual([]);
  });
});
