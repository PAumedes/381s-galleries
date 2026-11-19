import { describe, expect, it } from "vitest";
import { en } from "../app/i18n/en";
import { es } from "../app/i18n/es";

describe("privacy retention text", () => {
  it("does not promise deletion with the gallery (stats rows are kept)", () => {
    expect(en["privacy.retention.body"]).not.toMatch(/deleted when/i);
    expect(es["privacy.retention.body"]).not.toMatch(/se eliminan cuando/i);
    expect(en["privacy.retention.body"]).toMatch(
      /nothing is deleted automatically/,
    );
    expect(es["privacy.retention.body"]).toMatch(
      /no se elimina automáticamente/,
    );
  });
  it("says hashes cannot be linked across galleries", () => {
    expect(en["privacy.ip.body"]).toMatch(/different in each gallery/);
    expect(es["privacy.ip.body"]).toMatch(/distinto en cada galería/);
  });
});
