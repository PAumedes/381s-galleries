import { describe, expect, it } from "vitest";
import { es } from "../../app/i18n/es";
import { makeT } from "../../app/i18n/t";
import { HELP_SECTIONS } from "../../app/lib/help";
import { helpMatches, resolveHelpItem } from "../../app/lib/help-text";

// T6.57: the owner searches with the word he has in his head, not the one the
// author used. Search is a plain substring test (no stems, no synonyms), so the
// most natural words find nothing or the wrong answer.
const t = makeT("es", es);
const items = HELP_SECTIONS.flatMap((s) => s.items);
const find = (q: string) =>
  items.filter((i) => helpMatches(resolveHelpItem(i, t), q)).map((i) => i.id);

describe("T6.57 adversarial: help search finds what a person types", () => {
  it.each([
    ["borrar", "albums-delete"], // "¿Cómo elimino un álbum?" says "se borran", never "borrar"
    ["ocultar", "albums-hide"], // question is "¿Cómo oculto un álbum...?"
    ["contraseña", "access-pin-album"], // the PIN is what people call a password
    ["clave", "access-pin-album"],
    ["link", "albums-share"], // the whole app says "enlace"
    ["watermark", "proof-setup"],
    ["vencimiento", "albums-expiry"], // "vence"/"vencer" only
    ["zip", "proof-sizes"], // "todo en un solo archivo"
  ])("searching %s finds %s", (q, id) => {
    expect(find(q)).toContain(id);
  });
});
