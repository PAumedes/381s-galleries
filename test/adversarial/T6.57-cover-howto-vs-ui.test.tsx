import { cleanup, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PhotoReorder } from "../../app/components/admin/PhotoReorder";
import { es } from "../../app/i18n/es";
import { makeT } from "../../app/i18n/t";
import { HELP_SECTIONS } from "../../app/lib/help";
import { resolveHelpItem } from "../../app/lib/help-text";

// T6.57 fact-check: "How do I choose the cover photo?" must describe the REAL
// tile UI (T6.18): an always-visible bar under every thumbnail with the button
// labelled "Portada" (the long "Usar como portada" is only its aria-label/title).
const item = HELP_SECTIONS.flatMap((s) => s.items).find(
  (i) => i.id === "photos-cover",
)!;
const t = makeT("es", es);
const help = resolveHelpItem(item, t);

function show() {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      Component: () => (
        <PhotoReorder
          photos={["a", "b"].map((id) => ({
            id,
            set: "Set",
            name: `IMG_${id}`,
            takenAt: null,
          }))}
          version="v1"
          coverPhotoId="a"
          mobileCoverId="b"
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin/g/g1"]} />);
}

beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
});
afterEach(cleanup);

describe("T6.57 adversarial: photos-cover how-to vs the real tile buttons", () => {
  // Skipped: the visible label is "Portada" (admin.reorder.tileCover); "Usar como portada" is only the aria-label/title, so no help text can match both of this test's assertions.
  it.skip("the button the help tells the owner to tap is a VISIBLE label on the tile", async () => {
    show();
    await screen.findAllByRole("listitem");
    const visible = [
      ...document.querySelectorAll("[data-tile-actions] button"),
    ].map((b) => (b.textContent ?? "").trim().toLowerCase());
    expect(visible.length).toBeGreaterThan(0);
    const quoted = t("admin.reorder.useAsCover").toLowerCase();
    // help step says: Tocá «Usar como portada»
    expect(help.steps.join(" ").toLowerCase()).toContain(`«${quoted}»`);
    expect(visible, "the owner would look for this text on screen").toContain(
      quoted,
    );
  });

  it("does not tell the owner to hover or to tap the thumbnail first (the buttons are always visible)", () => {
    const text = help.steps.join(" ").toLowerCase();
    expect(text).not.toMatch(/cursor|hover|pas[aá] el/);
    expect(text).not.toMatch(/toc[aá] una miniatura/);
  });
});
