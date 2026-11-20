import { describe, expect, it } from "vitest";
import {
  methodNotAllowed,
  NOSNIFF,
  NO_STORE,
  PRIVATE_NO_STORE,
  textResponse,
} from "../app/lib/server/http";
import { shape } from "./support/http";

describe("T6.33 http helpers", () => {
  it("constants", () => {
    expect(NOSNIFF).toEqual({ "X-Content-Type-Options": "nosniff" });
    expect(NO_STORE).toBe("no-store");
    expect(PRIVATE_NO_STORE).toBe("private, no-store");
  });
  it("textResponse sets utf-8 text/plain, extra headers win", async () => {
    expect(await shape(textResponse("Gone", 410, { ...NOSNIFF }))).toEqual({
      status: 410,
      body: "Gone",
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
    const o = await shape(
      textResponse("x", 404, { "Content-Type": "text/plain" }),
    );
    expect(o.headers["content-type"]).toBe("text/plain");
  });
  it("methodNotAllowed", async () => {
    expect(await shape(methodNotAllowed("POST"))).toEqual({
      status: 405,
      body: "",
      headers: { allow: "POST" },
    });
    expect(
      await shape(
        methodNotAllowed("GET, HEAD", "Nope", { "Cache-Control": "no-store" }),
      ),
    ).toEqual({
      status: 405,
      body: "Nope",
      headers: {
        allow: "GET, HEAD",
        "cache-control": "no-store",
        "content-type": "text/plain;charset=UTF-8",
      },
    });
  });
});
