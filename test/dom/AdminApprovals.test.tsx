import { cleanup, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalsSection } from "../../app/components/admin/gallery-edit/ApprovalsSection";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";

// T6.53f: the owner's overview of the approvals (counts only).
afterEach(cleanup);

async function show(
  summary: { approved: number; total: number; pending: number },
  lang: "es" | "en" = "es",
) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang,
        messages: lang === "es" ? es : en,
        studioName: "381 Studios",
      }),
      Component: () => (
        <main>
          <ApprovalsSection summary={summary} />
        </main>
      ),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

describe("T6.53f admin approvals summary", () => {
  it("says N de M fotos aprobadas en su última versión, and how many are to review", async () => {
    await show({ approved: 3, total: 8, pending: 5 });
    expect(
      await screen.findByText("3 de 8 fotos aprobadas en su última versión"),
    ).toBeTruthy();
    expect(screen.getByText("5 por revisar")).toBeTruthy();
  });

  it("singular in Spanish, English in English", async () => {
    await show({ approved: 1, total: 1, pending: 0 });
    expect(
      await screen.findByText("1 de 1 foto aprobada en su última versión"),
    ).toBeTruthy();
    cleanup();
    await show({ approved: 2, total: 6, pending: 4 }, "en");
    expect(
      await screen.findByText("2 of 6 photos approved in their latest version"),
    ).toBeTruthy();
    expect(screen.getByText("4 to review")).toBeTruthy();
  });

  it("is a labelled region and is silent when there are no photos", async () => {
    await show({ approved: 0, total: 4, pending: 4 });
    expect(await screen.findByText("Aprobaciones")).toBeTruthy();
    cleanup();
    await show({ approved: 0, total: 0, pending: 0 });
    await screen.findByRole("main");
    expect(screen.queryByText("Aprobaciones")).toBeNull();
  });

  it("copy has no straight double quotes", () => {
    for (const d of [es, en])
      for (const [k, v] of Object.entries(d))
        if (
          k.startsWith("admin.edit.approvals") ||
          k.endsWith("section.approvals")
        )
          expect(v).not.toMatch(/"/);
  });
});
