import { describe, expect, it } from "vitest";
import { en } from "../app/i18n/en";
import { es } from "../app/i18n/es";

describe("privacy retention text", () => {
  it("says history is kept while the gallery exists, with no automatic deletion", () => {
    expect(en["privacy.retention.body"]).toMatch(
      /as long as the gallery exists/,
    );
    expect(en["privacy.retention.body"]).toMatch(
      /nothing is deleted automatically/,
    );
    expect(es["privacy.retention.body"]).toMatch(/mientras exista la galería/);
    expect(es["privacy.retention.body"]).toMatch(
      /no se elimina automáticamente/,
    );
  });
  it("promises deletion of everything with the gallery, except the Drive folder identifier", () => {
    const en_ = en["privacy.retention.body"];
    for (const w of [
      /all data associated with it is deleted/,
      /photo index/,
      /favorites/,
      /visits/,
      /downloads/,
      /cached images/,
      /PIN and visitor data/,
      /Only the Drive folder identifier and the date of deletion are kept/,
    ])
      expect(en_).toMatch(w);
    const es_ = es["privacy.retention.body"];
    for (const w of [
      /se eliminan todos los datos asociados/,
      /índice de fotos/,
      /favoritas/,
      /visitas/,
      /descargas/,
      /imágenes en caché/,
      /datos de PIN y de visitantes/,
      /Solo se conservan el identificador de la carpeta de Drive y la fecha de eliminación/,
    ])
      expect(es_).toMatch(w);
  });
  it("says hashes cannot be linked across galleries", () => {
    expect(en["privacy.ip.body"]).toMatch(/different in each gallery/);
    expect(es["privacy.ip.body"]).toMatch(/distinto en cada galería/);
  });
});
