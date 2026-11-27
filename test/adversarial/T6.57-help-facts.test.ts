import { describe, expect, it } from "vitest";
import { es } from "../../app/i18n/es";
import { makeT } from "../../app/i18n/t";
import { HELP_SECTIONS } from "../../app/lib/help";
import { resolveHelpItem } from "../../app/lib/help-text";
import { resolveSource } from "../../app/lib/server/image-source";

// T6.57 fact-check: claims in the help that the code (or the app's own
// dictionary) contradicts or leaves out.
const t = makeT("es", es);
const items = HELP_SECTIONS.flatMap((s) => s.items);
const text = (id: string) => {
  const r = resolveHelpItem(
    items.find((i) => i.id === id)!,
    t,
  );
  return [r.q, r.a ?? "", ...r.steps].join(" ");
};
const everything = items.map((i) => text(i.id)).join("\n");

describe("T6.57 adversarial: help vs code", () => {
  it("drive-folders: a missing thumb falls back to WEB first, not 'the largest size available'", () => {
    const photo = {
      id: "p",
      driveHighresId: "HI",
      driveWebId: "WEB",
      driveThumbId: null,
      driveIgId: null,
      driveWmId: null,
      driveTiffId: null,
      variantVersions: null,
    };
    // the real rule (PLAN 3 / image-source.ts): thumb -> web -> high-res
    expect(resolveSource(photo, false, "thumb")?.fileId).toBe("WEB");
    expect(text("drive-folders")).not.toMatch(/tamaño más grande que haya/);
  });

  it("trouble-download: the 'old link' step says links also die when a size is switched off or the mode changes (the editor says so)", () => {
    // the real note shown under Opciones
    expect(es["admin.edit.opt.revokeNote"]).toMatch(/anula de inmediato/);
    const item = items.find((i) => i.id === "trouble-download")!;
    const oldLinkStep = resolveHelpItem(item, t).steps.find((s) =>
      /enlace viejo/i.test(s),
    )!;
    expect(oldLinkStep).toBeTruthy();
    // it only names the PIN as the reason a link dies
    expect(oldLinkStep).toMatch(/tamaño|modo|Prueba/i);
  });

  it("clients-page: with a CLIENT PIN every tile is locked and has no cover (T6.52), not only the album-PIN ones", () => {
    expect(es["admin.clients.pin.note"]).toMatch(/sin portada/);
    expect(text("clients-page")).toMatch(
      /PIN del cliente|el cliente tiene PIN|si el cliente/i,
    );
  });

  it("albums-home / trouble-home: an album whose CLIENT has a PIN never shows on the home either", () => {
    expect(text("albums-home") + text("trouble-home")).toMatch(
      /PIN del cliente|cliente.*PIN/i,
    );
  });

  it("access-pin-client: setting a client PIN switches 'Mostrar en la portada' off on all its albums (T6.52)", () => {
    expect(text("access-pin-client")).toMatch(/portada|inicio|home/i);
  });

  it("start-brand: there are TWO logo uploads (light / dark background, the dark one optional)", () => {
    expect(es["admin.setup.logo.onDark"]).toMatch(/opcional/);
    expect(text("start-brand")).toMatch(/oscur/i);
  });

  it("versions-tiff: the TIFF download needs the high-res size switched on and leaves those photos out of the ZIP", () => {
    expect(text("versions-tiff") + text("trouble-download")).toMatch(
      /ZIP|un archivo|todo junto|no entra/i,
    );
  });

  it("new photos exported later are appended at the END of the album (sync appends after the existing sort), and nothing in the help says so", () => {
    expect(everything).toMatch(
      /al final|después de las demás|se suma al final/i,
    );
  });

  it("trouble-order explains the default order (capture date, then file name)", () => {
    expect(text("trouble-order")).toMatch(/fecha de captura|por fecha/i);
  });

  it("there is a question for removing a photo and one for adding photos to an album that exists", () => {
    const qs = items.map((i) => resolveHelpItem(i, t).q.toLowerCase());
    expect(
      qs.some((q) => /(saco|quito|borro|elimino|oculto).*foto/.test(q)),
    ).toBe(true);
    expect(
      qs.some((q) =>
        /(agrego|sumo|subo|agregar).*fotos?.*(álbum|existente|ya)/.test(q),
      ),
    ).toBe(true);
  });
});
