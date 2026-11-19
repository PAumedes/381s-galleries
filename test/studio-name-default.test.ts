import { describe, expect, it } from "vitest";
import { DEFAULT_STUDIO_NAME } from "../app/lib/default-studio-name";
import { buildManifest, pwaMeta, shortName } from "../app/lib/pwa";
import { getStudioName } from "../app/lib/server/admin";
import { galleryMeta } from "../app/lib/og";
import { meta as rootMeta } from "../app/root";

const noDb = {
  prepare() {
    throw new Error("no db");
  },
} as unknown as D1Database;

describe("T6.20 neutral studio-name default (STUDIO_NAME unset)", () => {
  it("is neutral", () => {
    expect(DEFAULT_STUDIO_NAME).toBe("Galleries");
    expect(DEFAULT_STUDIO_NAME).not.toMatch(/381/);
  });
  it("getStudioName falls back to the default, not the owner", async () => {
    const env = { DB: noDb, STUDIO_NAME: undefined } as never;
    expect(await getStudioName(env)).toBe(DEFAULT_STUDIO_NAME);
    expect(await getStudioName({ DB: noDb, STUDIO_NAME: "" } as never)).toBe(
      DEFAULT_STUDIO_NAME,
    );
  });
  it("getStudioName keeps an explicit STUDIO_NAME", async () => {
    expect(await getStudioName({ DB: noDb, STUDIO_NAME: "Luz" })).toBe("Luz");
  });
  it("shortName fallback and manifest carry no 381", () => {
    expect(shortName("")).toBe(DEFAULT_STUDIO_NAME);
    const m = JSON.stringify(buildManifest({ studio: DEFAULT_STUDIO_NAME }));
    expect(m).not.toMatch(/381/);
  });
  it("root meta without loader data uses the default (pwa tags)", () => {
    const tags = JSON.stringify(rootMeta({ loaderData: undefined } as never));
    expect(tags).not.toMatch(/381/);
    expect(tags).toContain(DEFAULT_STUDIO_NAME);
  });
  it("og + pwa tags for the default studio have no 381", () => {
    const tags = JSON.stringify([
      ...galleryMeta(undefined, {
        studio: DEFAULT_STUDIO_NAME,
        lang: "es",
        origin: "https://g.example",
      }),
      ...pwaMeta(undefined, { studio: DEFAULT_STUDIO_NAME }),
    ]);
    expect(tags).not.toMatch(/381/);
  });
});
