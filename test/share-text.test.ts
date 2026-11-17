import { expect, it } from "vitest";
import { wellFormed } from "../app/lib/text";
import { downloadFilename } from "../app/lib/server/downloads";

it("wellFormed replaces lone surrogates, keeps pairs", () => {
  expect(wellFormed("a\uD83Db")).toBe("a�b");
  expect(wellFormed("a\uDE00b")).toBe("a�b");
  expect(wellFormed("a😀b")).toBe("a😀b");
});
it("downloadFilename output is always encodable", () => {
  expect(() =>
    encodeURIComponent(downloadFilename("x\uD83D", "web")),
  ).not.toThrow();
});
