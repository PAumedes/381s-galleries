import { describe, expect, it } from "vitest";
import { en } from "../app/i18n/en";
import { enAdmin } from "../app/i18n/en.admin";
import { enHelp } from "../app/i18n/en.help";
import { enPublic } from "../app/i18n/en.public";
import { es } from "../app/i18n/es";
import { esAdmin } from "../app/i18n/es.admin";
import { esHelp } from "../app/i18n/es.help";
import { esPublic } from "../app/i18n/es.public";

describe("dictionary split (admin strings never reach public bundles)", () => {
  it("public dictionaries have no admin.* key", () => {
    for (const d of [esPublic, enPublic]) {
      expect(Object.keys(d).filter((k) => k.startsWith("admin."))).toEqual([]);
    }
  });
  it("admin dictionaries only have admin.* keys", () => {
    for (const d of [esAdmin, enAdmin, esHelp, enHelp]) {
      expect(Object.keys(d).every((k) => k.startsWith("admin."))).toBe(true);
    }
  });
  it("es / en are exactly the union, same keys in both languages", () => {
    expect(Object.keys(es).sort()).toEqual(
      [
        ...Object.keys(esPublic),
        ...Object.keys(esAdmin),
        ...Object.keys(esHelp),
      ].sort(),
    );
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });
});
