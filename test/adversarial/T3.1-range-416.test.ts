import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { signToken } from "../../app/lib/server/crypto";
import { serveDownload } from "../../app/lib/server/downloads";
import { DriveError } from "../../app/lib/server/drive-types";
import { pinFingerprint } from "../../app/lib/server/auth";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000e2";
beforeAll(async () => {
  await migrateDb();
});

it("unsatisfiable Range (Drive 416) is not reported as 502 bad gateway", async () => {
  await resetTables("downloads", "photos", "galleries");
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "r416",
    title: "t",
    status: "published",
  });
  await db.insert(schema.photos).values({
    id: "p1",
    galleryId: G,
    baseName: "x",
    driveHighresId: "hr",
    sort: 1,
  });
  const token = await signToken(
    {
      t: "dl",
      jti: "j2",
      g: G,
      p: "p1",
      v: "highres",
      vid: "v",
      pf: await pinFingerprint(null, env as Env),
    },
    env.DOWNLOAD_SECRET,
    600,
  );
  const drive = {
    streamFile: async () => {
      throw new DriveError(416, "range");
    },
  };
  const res = await serveDownload(
    new Request("https://x.test/dl/" + token, {
      headers: { Range: "bytes=999999-" },
    }),
    token,
    { ...env, DRIVE_MODE: "google" } as Env,
    { drive: drive as never },
  );
  expect(res.status).toBe(416);
});
