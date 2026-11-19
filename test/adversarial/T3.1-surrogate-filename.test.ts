import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { signToken } from "../../app/lib/server/crypto";
import { serveDownload } from "../../app/lib/server/downloads";
import { pinFingerprint } from "../../app/lib/server/auth";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000e1";
beforeAll(async () => {
  await migrateDb();
});

it("a long base_name whose 200th UTF-16 unit splits an emoji still downloads", async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM downloads"),
    env.DB.prepare("DELETE FROM photos"),
    env.DB.prepare("DELETE FROM galleries"),
  ]);
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "emoji",
    title: "t",
    status: "published",
  });
  await db.insert(schema.photos).values({
    id: "p1",
    galleryId: G,
    baseName: "a".repeat(199) + "😀",
    driveHighresId: "hr",
    sort: 1,
  });
  const gal = (await db.select().from(schema.galleries))[0];
  const token = await signToken(
    {
      t: "dl",
      jti: "j1",
      g: G,
      p: "p1",
      v: "highres",
      vid: "v",
      pf: await pinFingerprint(gal.pinHash, env as Env),
    },
    env.DOWNLOAD_SECRET,
    600,
  );
  const drive = {
    streamFile: async () =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
  };
  const res = await serveDownload(
    new Request("https://x.test/dl/" + token),
    token,
    { ...env, DRIVE_MODE: "google" } as Env,
    { drive: drive as never },
  );
  expect(res.status).toBe(200);
});
