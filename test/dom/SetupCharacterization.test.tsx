import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import {
  SetupView,
  type SetupActionData,
  type SetupViewData,
} from "../../app/components/admin/SetupView";

/**
 * Characterization of the setup page: a DOM snapshot per state so the view can
 * be split into section components with byte-identical markup.
 */

const full: SetupViewData = {
  connected: true,
  mock: false,
  rootName: "Mi Carpeta",
  studioName: "381 Studios",
  lastSyncAt: "2026-11-01T12:00:00Z",
  cacheWarm: { warmed: 3, total: 10 },
  logo: { onLight: "v1", onDark: null },
  lastError: { at: "2026-11-02T08:00:00Z", message: "boom" },
  ignoredFolders: [
    { handle: "h1", deletedAt: "2026-10-01T00:00:00Z" },
    { handle: "h2", deletedAt: "2026-10-02T00:00:00Z" },
  ],
};
const empty: SetupViewData = {
  connected: false,
  mock: true,
  rootName: null,
  studioName: "X",
  lastSyncAt: null,
  lastError: null,
};
const synced: SetupActionData = {
  intent: "sync",
  ok: true,
  result: {
    galleries: { created: 1, updated: 2, archived: 3 },
    photos: { added: 4, updated: 5, removed: 6 },
    issues: 7,
  },
};

async function html(data: SetupViewData, actionData?: SetupActionData) {
  const Stub = createRoutesStub([
    {
      path: "/admin/setup",
      Component: () => <SetupView data={data} actionData={actionData} />,
    },
  ]);
  const { container } = render(<Stub initialEntries={["/admin/setup"]} />);
  await screen.findByRole("heading", { level: 1 });
  return container.innerHTML.replace(/blob:[^"]+/g, "blob:X");
}

describe("SetupView characterization (T6.47)", () => {
  it("connected, everything populated + sync summary", async () => {
    expect(await html(full, synced)).toMatchSnapshot();
  });
  it("demo / empty state", async () => {
    expect(await html(empty)).toMatchSnapshot();
  });
  it("error feedback", async () => {
    expect(
      await html(full, { intent: "root", ok: false, error: "bad" }),
    ).toMatchSnapshot();
  });
  it("skipped sync", async () => {
    expect(
      await html(full, {
        ...synced,
        result: { ...synced.result!, skipped: "locked" },
      }),
    ).toMatchSnapshot();
  });

  it("connected but no root folder chosen", async () => {
    expect(
      await html({ ...full, rootName: null, ignoredFolders: [] }),
    ).toMatchSnapshot();
  });
  it("not connected and not demo", async () => {
    expect(
      await html({
        ...full,
        connected: false,
        mock: false,
        rootName: null,
        cacheWarm: undefined,
        lastError: null,
      }),
    ).toMatchSnapshot();
  });
  it("both logos uploaded", async () => {
    expect(
      await html({ ...full, logo: { onLight: "v1", onDark: "v2" } }),
    ).toMatchSnapshot();
  });
  it("only a dark logo uploaded", async () => {
    expect(
      await html({ ...full, logo: { onLight: null, onDark: "v2" } }),
    ).toMatchSnapshot();
  });
  it("success message feedback for the studio intent", async () => {
    expect(
      await html(full, { intent: "studio", ok: true, message: "Guardado" }),
    ).toMatchSnapshot();
  });
});

describe("SetupView pending logo previews (T6.47)", () => {
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  afterEach(() => {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  });
  const png = () =>
    new File([new Uint8Array([1])], "a.png", { type: "image/png" });

  async function pick(label: string, data: SetupViewData, files: string[]) {
    let n = 0;
    URL.createObjectURL = () => `blob:${n++}`;
    URL.revokeObjectURL = () => {};
    const Stub = createRoutesStub([
      {
        path: "/admin/setup",
        Component: () => <SetupView data={data} actionData={undefined} />,
      },
    ]);
    const { container } = render(<Stub initialEntries={["/admin/setup"]} />);
    for (const l of files)
      fireEvent.change(await screen.findByLabelText(l), {
        target: { files: [png()] },
      });
    void label;
    return container.innerHTML.replace(/blob:[^"]+/g, "blob:X");
  }

  it("light pick without an uploaded dark logo: dark swatch shows it inverted", async () => {
    const out = await pick(
      "l",
      { ...empty, logo: { onLight: null, onDark: null } },
      ["Logo para fondos claros"],
    );
    expect(out).toMatchSnapshot();
    expect(out).toContain("brightness-0 invert");
  });
  it("light pick with an uploaded dark logo: dark swatch keeps the upload (no invert)", async () => {
    const out = await pick(
      "l",
      { ...empty, logo: { onLight: null, onDark: "v2" } },
      ["Logo para fondos claros"],
    );
    expect(out).toMatchSnapshot();
    expect(out).not.toContain("brightness-0 invert");
  });
  it("dark pick, then light pick: both previews are the picked files", async () => {
    const out = await pick(
      "d",
      { ...empty, logo: { onLight: null, onDark: null } },
      ["Logo para fondos oscuros (opcional)", "Logo para fondos claros"],
    );
    expect(out).toMatchSnapshot();
    expect(out).not.toContain("brightness-0 invert");
  });
});

describe("SetupView busy state and confirms (T6.47)", () => {
  const origConfirm = window.confirm;
  afterEach(() => {
    window.confirm = origConfirm;
  });

  it("shows the syncing label (and disables the buttons) while the sync submits", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin/setup",
        Component: () => <SetupView data={full} actionData={undefined} />,
        action: () => new Promise(() => {}),
      },
    ]);
    const { container } = render(<Stub initialEntries={["/admin/setup"]} />);
    const form = (
      container.querySelector('input[value="sync"]') as HTMLInputElement
    ).form!;
    await userEvent
      .setup()
      .click(form.querySelector("button[type=submit]") as HTMLElement);
    await waitFor(() => expect(form.textContent).toBe("Sincronizando…"));
    expect(container.innerHTML).toMatchSnapshot();
  });

  function confirms(answer: boolean) {
    const asked: string[] = [];
    window.confirm = (m?: string) => (asked.push(String(m)), answer);
    return asked;
  }
  async function formOf(data: SetupViewData, intent: string) {
    const Stub = createRoutesStub([
      {
        path: "/admin/setup",
        Component: () => <SetupView data={data} actionData={undefined} />,
      },
    ]);
    const { container } = render(<Stub initialEntries={["/admin/setup"]} />);
    await screen.findByRole("heading", { level: 1 });
    return (
      container.querySelector(`input[value="${intent}"]`) as HTMLInputElement
    ).form!;
  }

  it("root form asks to confirm when a root exists; declining cancels the submit", async () => {
    const asked = confirms(false);
    const form = await formOf(full, "root");
    expect(fireEvent.submit(form)).toBe(false);
    expect(asked).toHaveLength(1);
    expect(form.querySelector('input[name="confirm"]')).not.toBeNull();
  });
  it("root form does not ask without a root folder", async () => {
    const asked = confirms(false);
    const form = await formOf({ ...full, rootName: null }, "root");
    fireEvent.submit(form);
    expect(asked).toHaveLength(0);
    expect(form.querySelector('input[name="confirm"]')).toBeNull();
  });
  it("re-include asks to confirm; declining cancels, accepting asks once more and goes on", async () => {
    const asked = confirms(false);
    const form = await formOf(full, "reinclude");
    expect(fireEvent.submit(form)).toBe(false);
    expect(asked).toHaveLength(1);
    const accepted = confirms(true);
    fireEvent.submit(form);
    expect(accepted).toHaveLength(1);
  });
});
