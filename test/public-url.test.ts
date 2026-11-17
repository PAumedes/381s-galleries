import { describe, expect, it } from "vitest";
import { publicGalleryUrl, publicOrigin } from "../app/lib/server/public-url";

const req = new Request("http://evil.test:9/x");
describe("public-url", () => {
  it("uses a valid https origin", () => {
    expect(
      publicGalleryUrl({ PUBLIC_ORIGIN: "https://a.example.com/" }, req, "s"),
    ).toBe("https://a.example.com/s");
  });
  it("allows http only for localhost", () => {
    expect(publicOrigin({ PUBLIC_ORIGIN: "http://localhost:5173" }, req)).toBe(
      "http://localhost:5173",
    );
    expect(publicOrigin({ PUBLIC_ORIGIN: "http://a.example.com" }, req)).toBe(
      "http://evil.test:9",
    );
  });
  it.each(["", "nope", "javascript:alert(1)", "https://u:p@a.com"])(
    "falls back to request origin for %j",
    (v) => {
      expect(publicOrigin({ PUBLIC_ORIGIN: v }, req)).toBe(
        "http://evil.test:9",
      );
    },
  );
  it("falls back when unset", () => {
    expect(publicOrigin({}, req)).toBe("http://evil.test:9");
  });
});
