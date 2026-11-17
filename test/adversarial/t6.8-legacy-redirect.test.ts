import { describe, expect, it } from "vitest";
import { legacyRedirect } from "../../app/lib/server/legacy-redirect";

const env = {
  PUBLIC_ORIGIN: "https://gallery.381studios.ar",
  LEGACY_HOSTS: "session.381studios.ar",
};

describe("T6.8 adversarial", () => {
  it("redirects the FQDN form with a trailing dot too", () => {
    const r = legacyRedirect(
      new Request("https://session.381studios.ar./boda"),
      env,
    );
    expect(r).not.toBeNull();
  });

  it("never downgrades to http for a non-local PUBLIC_ORIGIN (publicOrigin rejects it)", () => {
    const r = legacyRedirect(new Request("https://session.381studios.ar/x"), {
      PUBLIC_ORIGIN: "http://gallery.381studios.ar",
      LEGACY_HOSTS: "session.381studios.ar",
    });
    expect(r?.headers.get("Location") ?? "").not.toMatch(/^http:/);
  });

  it("does not leave a legacy host serving the full app when PUBLIC_ORIGIN is invalid (fail-open)", () => {
    const r = legacyRedirect(new Request("https://session.381studios.ar/x"), {
      PUBLIC_ORIGIN: "",
      LEGACY_HOSTS: "session.381studios.ar",
    });
    expect(r).not.toBeNull();
  });
});
