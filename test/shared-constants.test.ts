import { describe, expect, it } from "vitest";
import { schema } from "../app/db";
import { VARIANTS } from "../app/lib/server/images";

// T6.38 characterization: the literal lists the client, server and schema agree on.
describe("T6.38 shared literal lists", () => {
  it("image variants", () => {
    expect([...VARIANTS]).toEqual(["thumb", "view-sm", "view-lg"]);
  });

  it("gallery modes (schema enum)", () => {
    expect([...schema.galleries.mode.enumValues]).toEqual([
      "proofing",
      "delivery",
    ]);
  });

  it("gallery statuses (schema enum)", () => {
    expect([...schema.galleries.status.enumValues]).toEqual([
      "draft",
      "published",
      "archived",
    ]);
  });
});
