import { act, fireEvent, render, screen } from "@testing-library/react";
import { RouterProvider, Form, createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { SubmitButton } from "../../app/components/admin/clients/SubmitButton";

function setup(action: () => Promise<unknown>) {
  const router = createMemoryRouter([
    {
      path: "/",
      action,
      Component: () => (
        <>
          <Form method="post" data-testid="f1">
            <input name="x" />
            <SubmitButton
              intent="create"
              label="Crear"
              pendingLabel="Creando…"
            />
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="delete" />
            <SubmitButton
              intent="delete"
              label="Eliminar"
              pendingLabel="Eliminando…"
            />
          </Form>
        </>
      ),
    },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

describe("T6.46 SubmitButton", () => {
  it("disables both buttons while pending, one shows busy, then recovers after an error result", async () => {
    let calls = 0;
    let release!: (v: unknown) => void;
    setup(() => {
      calls++;
      return new Promise((r) => (release = r));
    });
    const [a, b] = screen.getAllByRole("button") as HTMLButtonElement[];
    await act(async () => {
      fireEvent.click(a!);
    });
    expect(a!.disabled).toBe(true);
    expect(b!.disabled).toBe(true);
    expect(a!.getAttribute("aria-busy")).toBe("true");
    expect(b!.getAttribute("aria-busy")).toBeNull();
    expect(a!.textContent).toContain("Creando…");
    await act(async () => {
      fireEvent.click(a!);
      fireEvent.click(b!);
    });
    expect(calls).toBe(1);
    await act(async () => {
      release({ ok: false, error: "boom" });
    });
    expect(a!.disabled).toBe(false);
    expect(a!.getAttribute("aria-busy")).toBeNull();
    expect(a!.textContent).toBe("Crear");
  });
});
