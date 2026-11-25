// T6.51 guard: the `vid` claim of a download token must be the visitor row's id
// (the /dl log attributes the download to it). Mutating issueToken to
// `vid: "x"` left test/download-token-payload.test.ts and downloads.test.ts green.
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { verifyToken } from "../../app/lib/server/crypto";
import { handleDownloadTokens } from "../../app/lib/server/downloads";
import { migrateDb, resetTables } from "../support/d1";

const G = "gggggggg-0000-0000-0000-0000000000f1";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables(
    "downloads",
    "visitors",
    "rate_limits",
    "photos",
    "galleries",
  );
  const db = getDb(env);
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f-" + G,
    slug: "boda",
    title: "Boda",
    status: "published",
    requireEmail: false,
  });
  await db.insert(schema.photos).values({
    id: "p1",
    galleryId: G,
    baseName: "IMG_1",
    driveHighresId: "hr",
    highresBytes: 1,
    width: 3,
    height: 2,
    sort: 1,
  });
});

describe("T6.51 download token vid claim", () => {
  it("is the id of the visitor row the request was bound to", async () => {
    const res = await handleDownloadTokens(
      new Request("https://s.test/api/g/boda/download-tokens", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "9.9.9.9",
        },
        body: JSON.stringify({ photoIds: ["p1"], variant: "highres" }),
      }),
      "boda",
      env,
    );
    const body = (await res.json()) as { tokens: { url: string }[] };
    const claims = await verifyToken<{ vid: string }>(
      body.tokens[0].url.replace("/dl/", ""),
      env.DOWNLOAD_SECRET,
    );
    const rows = (
      await env.DB.prepare("SELECT id FROM visitors").all<{ id: string }>()
    ).results;
    expect(rows).toHaveLength(1);
    expect(claims?.vid).toBe(rows[0].id);
  });
});
