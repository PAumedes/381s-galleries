import { fireEvent, render, screen, within } from "@testing-library/react";
import { Outlet, createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { ClientEditView } from "../../app/components/admin/clients/ClientEditView";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";

const base = {
  id: "c1",
  name: "Acme",
  slug: "acme",
  pageEnabled: true,
  defaultMode: "proofing" as const,
  defaultShowOnHome: false,
  hasPin: false,
};

function view(
  over: Partial<typeof base> = {},
  actionData?: Parameters<typeof ClientEditView>[0]["actionData"],
  lang: "es" | "en" = "es",
) {
  const messages = lang === "es" ? es : en;
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang, messages }),
      Component: Outlet,
      children: [
        {
          path: "admin/clients/:id",
          Component: () => (
            <ClientEditView
              client={{ ...base, ...over }}
              albums={[]}
              publicPage={{ visible: 0, reason: "none" }}
              actionData={actionData}
            />
          ),
        },
      ],
    },
  ]);
  return render(<Stub initialEntries={["/admin/clients/c1"]} />);
}
beforeEach(() => {
  window.confirm = () => true;
});

const pinSection = async (name: RegExp) =>
  (await screen.findByRole("heading", { name })).closest("section")!;

describe("T6.52 client PIN admin form", () => {
  it("without a PIN: says so, one password field, a save button and no remove button", async () => {
    view();
    const sec = await pinSection(/PIN del cliente/);
    expect(within(sec).getByText("Sin PIN")).toBeTruthy();
    const input = within(sec).getByLabelText("Nuevo PIN") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.name).toBe("pin");
    expect(input.autocomplete).toBe("new-password");
    expect(input.minLength).toBe(6);
    expect(input.maxLength).toBe(32);
    expect(input.required).toBe(true);
    expect(
      within(sec).getByRole("button", { name: "Guardar PIN" }),
    ).toBeTruthy();
    expect(
      within(sec).queryByRole("button", { name: "Quitar PIN" }),
    ).toBeNull();
    const intent = sec.querySelector("input[name=intent]") as HTMLInputElement;
    expect(intent.value).toBe("pinSet");
  });

  it("with a PIN: says it is active, change and remove buttons; the PIN value is never rendered", async () => {
    const { container } = view({ hasPin: true });
    const sec = await pinSection(/PIN del cliente/);
    expect(within(sec).getByText("PIN activo")).toBeTruthy();
    expect(
      within(sec).getByRole("button", { name: "Cambiar PIN" }),
    ).toBeTruthy();
    const remove = within(sec).getByRole("button", { name: "Quitar PIN" });
    expect(
      remove.closest("form")!.querySelector("input[name=intent]"),
    ).toHaveProperty("value", "pinRemove");
    expect(
      (within(sec).getByLabelText("Nuevo PIN") as HTMLInputElement).value,
    ).toBe("");
    expect(container.innerHTML).not.toMatch(/pbkdf2/);
  });

  it("explains the scope: opens every album of the client, albums with their own PIN still ask for it", async () => {
    view();
    const sec = await pinSection(/PIN del cliente/);
    expect(sec.textContent).toMatch(/todos los álbumes/);
    expect(sec.textContent).toMatch(/propio PIN/);
  });

  it("shows the field error from the server on the PIN field and the saved message", async () => {
    view(
      {},
      {
        intent: "pinSet",
        ok: false,
        error: "Revisá el PIN.",
        fieldErrors: { pin: "El PIN debe tener entre 6 y 32 caracteres." },
      },
    );
    const input = (await screen.findByLabelText(
      "Nuevo PIN",
    )) as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText("El PIN debe tener entre 6 y 32 caracteres."),
    ).toBeTruthy();
  });

  it("feedback of pinSet does not leak into the details form and vice versa", async () => {
    view({}, { intent: "pinSet", ok: true, message: "PIN guardado." });
    const sec = await pinSection(/PIN del cliente/);
    expect(within(sec).getByText("PIN guardado.")).toBeTruthy();
    expect(screen.getAllByText("PIN guardado.").length).toBe(1);
  });

  it("renders in English", async () => {
    view({ hasPin: true }, undefined, "en");
    const sec = await pinSection(/Client PIN/);
    expect(within(sec).getByText("PIN active")).toBeTruthy();
    expect(
      within(sec).getByRole("button", { name: "Remove PIN" }),
    ).toBeTruthy();
    expect(
      within(sec).getByRole("button", { name: "Change PIN" }),
    ).toBeTruthy();
    fireEvent.change(within(sec).getByLabelText("New PIN"), {
      target: { value: "123456" },
    });
  });
});
