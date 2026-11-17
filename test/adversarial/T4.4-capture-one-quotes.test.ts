import { expect, it } from "vitest";
import {
  captureOneResult,
  captureOneString,
} from "../../app/lib/admin-activity";

it("names containing a double quote or a comma do not corrupt Capture One output", () => {
  const s = captureOneString(['Ana "la novia" 01.jpg'], "space");
  // an inner quote must be escaped or the name must not break the token boundary
  expect(s).not.toBe('"Ana "la novia" 01"');
});
// Superseded by spec: unsafe names are omitted (and reported), so the count is 1.
it.skip("comma mode: a name with a comma is not split into two names", () => {
  const parts = captureOneString(["IMG,1.jpg", "IMG_2.jpg"], "comma").split(
    ",",
  );
  expect(parts).toHaveLength(2);
});
it("unsafe names are omitted from the string and returned separately", () => {
  const r = captureOneResult(['a"b.jpg', "c,d.jpg", "ok.jpg"], "comma");
  expect(r).toEqual({ text: "ok", skipped: ['a"b', "c,d"] });
  expect(captureOneResult(["c,d.jpg", "x y.jpg"], "space")).toEqual({
    text: 'c,d "x y"',
    skipped: [],
  });
});
