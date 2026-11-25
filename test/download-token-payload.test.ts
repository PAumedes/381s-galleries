import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { verifyToken } from "../app/lib/server/crypto";
import { handleDownloadTokens } from "../app/lib/server/downloads";

// T6.51 characterization: the exact claims of an issued download token and
// the reply buckets (tokens / missing / unavailable) of handleDownloadTokens.
const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000e1";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables(
    "downloads",
    "favorites",
    "visitors",
    "rate_limits",
    "photos",
    "galleries",
  );
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f-" + G,
    slug: "boda",
    title: "Boda",
    status: "published",
    requireEmail: false,
  });
  const photo = (id: string, over = {}) => ({
    id,
    galleryId: G,
    baseName: `IMG_${id}`,
    driveHighresId: `hr-${id}`,
    driveWebId: `web-${id}`,
    driveIgId: `ig-${id}`,
    highresBytes: 1000,
    width: 3000,
    height: 2000,
    sort: 1,
    ...over,
  });
  await db
    .insert(schema.photos)
    .values([
      photo("p1"),
      photo("p2"),
      photo("p3", { driveWebId: null }),
    ]);
});

type Reply = {
  tokens: { photoId: string; url: string; filename: string }[];
  missing: string[];
  unavailable: string[];
};
async function ask(body: unknown) {
  const res = await handleDownloadTokens(
    new Request("https://session.test/api/g/boda/download-tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "9.9.9.9",
      },
      body: JSON.stringify(body),
    }),
    "boda",
    env,
  );
  return { res, body: (await res.json()) as Reply };
}
const claims = (url: string) =>
  verifyToken<Record<string, unknown>>(
    url.replace("/dl/", ""),
    env.DOWNLOAD_SECRET,
  );

describe("T6.51 download token payload (characterization)", () => {
  it("a single-photo token carries t, jti, g, p, v, vid, pf and no bulk tag", async () => {
    const { res, body } = await ask({ photoIds: ["p1"], variant: "highres" });
    expect(res.status).toBe(200);
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]).toMatchObject({
      photoId: "p1",
      filename: expect.stringContaining("IMG_p1"),
    });
    expect(body.tokens[0].url).toMatch(/^\/dl\/[\w-]+\.[\w-]+$/);
    const c = await claims(body.tokens[0].url);
    expect(Object.keys(c ?? {}).sort()).toEqual(
      ["exp", "g", "jti", "p", "pf", "t", "v", "vid"].sort(),
    );
    expect(c).toMatchObject({ t: "dl", g: G, p: "p1", v: "highres" });
    expect(typeof c?.vid).toBe("string");
  });

  it("a multi-photo request tags every token b:'multi' with a distinct jti", async () => {
    const { body } = await ask({ photoIds: ["p1", "p2"], variant: "web" });
    const cs = await Promise.all(body.tokens.map((t) => claims(t.url)));
    expect(cs.map((c) => c?.b)).toEqual(["multi", "multi"]);
    expect(cs.map((c) => c?.p)).toEqual(["p1", "p2"]);
    expect(new Set(cs.map((c) => c?.jti)).size).toBe(2);
    expect(cs.every((c) => c?.v === "web")).toBe(true);
  });

  it("missing and unavailable ids are reported in request order, never tokenised", async () => {
    const { res, body } = await ask({
      photoIds: ["nope", "p3", "p1"],
      variant: "web",
    });
    expect(res.status).toBe(200);
    expect(body.missing).toEqual(["nope"]);
    expect(body.unavailable).toEqual(["p3"]);
    expect(body.tokens.map((t) => t.photoId)).toEqual(["p1"]);
    expect(JSON.stringify(body)).not.toMatch(/hr-p|web-p|ig-p/);
  });

  it("a photo of another gallery is missing, not tokenised", async () => {
    await db.insert(schema.galleries).values({
      id: "gggggggg-0000-0000-0000-0000000000e2",
      driveFolderId: "f-other",
      slug: "otra",
      title: "Otra",
      status: "published",
    });
    await db.insert(schema.photos).values({
      id: "px",
      galleryId: "gggggggg-0000-0000-0000-0000000000e2",
      baseName: "IMG_px",
      driveHighresId: "hr-px",
      highresBytes: 1,
      width: 1,
      height: 1,
      sort: 1,
    });
    const { body } = await ask({ photoIds: ["px"], variant: "highres" });
    expect(body.missing).toEqual(["px"]);
    expect(body.tokens).toEqual([]);
  });
});
