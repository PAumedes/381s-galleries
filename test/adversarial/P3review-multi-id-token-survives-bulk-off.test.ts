import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import {
  handleDownloadTokens,
  serveDownload,
} from "../../app/lib/server/downloads";
import type { DriveClient } from "../../app/lib/server/drive-types";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000f1";
beforeAll(async () => {
  await migrateDb();
});

it("tokens issued for a multi-id (bulk-gated) request stop working when allow_bulk is turned off", async () => {
  await resetTables(
    "downloads",
    "visitors",
    "rate_limits",
    "photos",
    "galleries",
  );
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "mb",
    title: "t",
    status: "published",
    requireEmail: false,
    allowBulk: true,
  });
  for (const id of ["p1", "p2"])
    await db.insert(schema.photos).values({
      id,
      galleryId: G,
      baseName: id,
      driveHighresId: "hr" + id,
      sort: 1,
    });
  const res = await handleDownloadTokens(
    new Request("https://s.test/api/g/mb/download-tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "7.7.7.7",
      },
      body: JSON.stringify({ photoIds: ["p1", "p2"], variant: "highres" }),
    }),
    "mb",
    env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { url: string }[] };
  expect(body.tokens).toHaveLength(2);
  await db
    .update(schema.galleries)
    .set({ allowBulk: false })
    .where(eq(schema.galleries.id, G));
  const drive = {
    streamFile: async () =>
      new Response(new Uint8Array([1]), {
        headers: { "Content-Type": "image/jpeg" },
      }),
  } as unknown as DriveClient;
  for (const t of body.tokens) {
    const token = t.url.replace("/dl/", "");
    const r = await serveDownload(
      new Request("https://s.test/dl/" + token),
      token,
      { ...env, DRIVE_MODE: "google" } as Env,
      { drive },
    );
    expect(r.status).toBe(410);
  }
});
