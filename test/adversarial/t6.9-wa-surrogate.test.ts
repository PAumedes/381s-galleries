import { describe, expect, it } from "vitest";
import { whatsappHref } from "../../app/lib/share";

describe("T6.9 whatsappHref robustness", () => {
  it("does not throw on a title with a lone surrogate (would crash the admin SharePanel render)", () => {
    expect(() =>
      whatsappHref("Sharing the gallery \uD83D:", "https://x.test/a"),
    ).not.toThrow();
  });
});
