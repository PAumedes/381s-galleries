import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { PinScreen } from "../../app/components/PinScreen";

// T6.54 (4)+(6): the PIN gate says which PIN it wants, accepts one field, and
// answers every wrong attempt visibly.
type Props = Parameters<typeof PinScreen>[0];
function gate(
  props: Partial<Props> = {},
  lang: "es" | "en" = "es",
  action: () => unknown = () => ({ error: "x", attempt: 1 }),
) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang, messages: lang === "es" ? es : en }),
      action,
      Component: () => <PinScreen title="Boda" {...props} />,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}
afterEach(cleanup);

describe("T6.54 PIN gate labels", () => {
  it("client step: visible label 'PIN del cliente' (ES) / 'Client PIN' (EN)", async () => {
    gate({ step: "client" });
    const input = await screen.findByLabelText("PIN del cliente");
    expect((input as HTMLInputElement).type).toBe("password");
    cleanup();
    gate({ step: "client" }, "en");
    expect(await screen.findByLabelText("Client PIN")).toBeTruthy();
  });
  it("album step: 'PIN de la galería' / 'Gallery PIN'", async () => {
    gate({ step: "album" });
    expect(await screen.findByLabelText("PIN de la galería")).toBeTruthy();
    cleanup();
    gate({ step: "album" }, "en");
    expect(await screen.findByLabelText("Gallery PIN")).toBeTruthy();
  });
  it("after the client step: says it was accepted (status) and asks for the album PIN", async () => {
    gate({ step: "album", clientAccepted: true });
    const st = await screen.findByRole("status");
    expect(st.textContent).toBe(
      "PIN del cliente aceptado. Ahora ingresá el PIN de la galería.",
    );
    expect(screen.getByLabelText("PIN de la galería")).toBeTruthy();
    // and focuses the new field so it can be typed right away
    expect(document.activeElement).toBe(
      screen.getByLabelText("PIN de la galería"),
    );
  });
  it("no accepted note on a plain gate", async () => {
    gate({ step: "album" });
    await screen.findByLabelText("PIN de la galería");
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("one field only (plus the hidden attempt counter)", async () => {
    gate({ step: "client" });
    await screen.findByLabelText("PIN del cliente");
    const inputs = [...document.querySelectorAll("input")].filter(
      (i) => i.type !== "hidden",
    );
    expect(inputs).toHaveLength(1);
  });
});

describe("T6.54 wrong PIN feedback", () => {
  const wrong = (attempt: number) => ({
    error: `PIN del cliente incorrecto (intento ${attempt})`,
    attempt,
  });
  it("announces the error (alert), marks the field invalid, shakes it, refocuses and carries the attempt", async () => {
    gate({ step: "client", error: wrong(1).error, attempt: 1 });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("PIN del cliente incorrecto (intento 1)");
    const input = screen.getByLabelText("PIN del cliente") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(input.closest("[data-pin-shake]")).toBeTruthy();
    expect(
      (document.querySelector("input[name=attempt]") as HTMLInputElement).value,
    ).toBe("1");
  });
  it("no shake and no alert before any attempt; the counter starts at 0", async () => {
    gate({ step: "client" });
    await screen.findByLabelText("PIN del cliente");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector("[data-pin-shake]")).toBeNull();
    expect(
      (document.querySelector("input[name=attempt]") as HTMLInputElement).value,
    ).toBe("0");
  });
  it("a second wrong attempt replaces the alert node and the field (clears it, restarts the shake)", async () => {
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        loader: () => ({ lang: "es", messages: es }),
        action: () => ({ ...wrong(2) }),
        Component: ({
          actionData,
        }: {
          actionData?: { error?: string; attempt?: number };
        }) => (
          <PinScreen
            title="Boda"
            step="client"
            error={actionData?.error ?? wrong(1).error}
            attempt={actionData?.attempt ?? 1}
          />
        ),
      },
    ] as never);
    render(<Stub initialEntries={["/"]} />);
    const alert1 = await screen.findByRole("alert");
    const input1 = screen.getByLabelText("PIN del cliente") as HTMLInputElement;
    fireEvent.change(input1, { target: { value: "000000" } });
    await act(async () => {
      fireEvent.submit(input1.form!);
    });
    const alert2 = await screen.findByText(
      "PIN del cliente incorrecto (intento 2)",
    );
    expect(alert2).not.toBe(alert1);
    const input2 = screen.getByLabelText("PIN del cliente") as HTMLInputElement;
    expect(input2).not.toBe(input1);
    expect(input2.value).toBe("");
    expect(document.activeElement).toBe(input2);
  });
  it("while the answer is pending the button is disabled, busy and says it is checking", async () => {
    gate({ step: "album" }, "es", () => new Promise(() => {}));
    const input = (await screen.findByLabelText(
      "PIN de la galería",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "123456" } });
    const btn = screen.getByRole("button", {
      name: "Entrar",
    }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.submit(input.form!);
    });
    const busy = (await screen.findByRole("button", {
      name: "Verificando…",
    })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(btn).toBeTruthy();
  });
});
