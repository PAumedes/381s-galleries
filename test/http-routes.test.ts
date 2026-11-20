import { describe, expect, it } from "vitest";
import { action as bulk } from "../app/routes/api.g.$slug.bulk";
import { action as tokens } from "../app/routes/api.g.$slug.download-tokens";
import { action as favorites } from "../app/routes/api.g.$slug.favorites";
import { action as visitor } from "../app/routes/api.g.$slug.visitor";
import { shape } from "./support/http";

describe("T6.33 POST-only API routes: 405 shape", () => {
  it.each([
    ["bulk", bulk],
    ["download-tokens", tokens],
    ["favorites", favorites],
    ["visitor", visitor],
  ])("%s", async (_n, act) => {
    const res = await (act as (a: unknown) => Promise<Response>)({
      request: new Request("https://gallery.test/api/g/x/y"),
      params: { slug: "x" },
    });
    expect(await shape(res)).toEqual({
      status: 405,
      body: "",
      headers: { allow: "POST" },
    });
  });
});
