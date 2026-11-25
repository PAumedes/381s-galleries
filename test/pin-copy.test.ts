import { describe, expect, it } from "vitest";
import { en } from "../app/i18n/en";
import { es } from "../app/i18n/es";

// T6.54 (3): the "saved" messages say in plain words what happens to people.
const KEYS = [
  "admin.msg.pinSaved",
  "admin.msg.pinRemoved",
  "admin.msg.pinRemovedOpen",
  "admin.clients.msg.pinSaved",
  "admin.clients.msg.pinRemoved",
] as const;
const SAVED = ["admin.msg.pinSaved", "admin.clients.msg.pinSaved"] as const;

describe("T6.54 PIN saved/removed messages (plain words)", () => {
  it.each(KEYS)("%s no longer uses the unclear wording", (k) => {
    expect(es[k]).not.toMatch(/sin efecto|sesiones/i);
    expect(en[k]).not.toMatch(/earlier sessions|no longer work/i);
  });
  it.each(SAVED)(
    "%s: who already unlocked must enter the new PIN again",
    (k) => {
      expect(es[k]).toMatch(/volver a ingresar el nuevo PIN/);
      expect(en[k]).toMatch(/enter the new PIN again/);
    },
  );
  it.each(KEYS)("%s: download links sent earlier stop working", (k) => {
    expect(es[k]).toMatch(
      /enlaces de descarga enviados antes dejan de funcionar/,
    );
    expect(en[k]).toMatch(/download links sent earlier stop working/i);
  });
  it.each(KEYS)("%s has no ASCII double quotes or escaped quotes", (k) => {
    expect(es[k]).not.toMatch(/["\\]/);
    expect(en[k]).not.toMatch(/["\\]/);
  });
});
