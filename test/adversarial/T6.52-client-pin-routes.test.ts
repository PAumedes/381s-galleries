// T6.52 adversary: routes the shipped tests never exercise with a client PIN
// (download tokens, bulk, /dl, favorites, visitor, manifest).
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { hashPin } from "../../app/lib/server/crypto";
import {
  handleBulk,
  handleDownloadTokens,
  serveDownload,
} from "../../app/lib/server/downloads";
import {
  handleListFavorites,
  handleSetFavorite,
  handleVisitor,
} from "../../app/lib/server/favorites";
import { unlockGallery } from "../../app/lib/server/gallery";
import { handleManifest } from "../../app/lib/server/manifest";
import { migrateDb, resetTables } from "../support/d1";

const e = { ...env, DRIVE_MODE: "mock" } as Env;
const db = getDb(env);
const O = "https://s.test";
const CA = "cccccccc-0000-0000-0000-0000000000aa";
const G = "gggggggg-0000-0000-0000-0000000000aa";
const PIN = "client-pin-1";
let hash = "";

beforeAll(async () => {
  await migrateDb();
  hash = await hashPin(PIN);
});
beforeEach(async () => {
  await resetTables(
    "downloads",
    "favorites",
    "visitors",
    "rate_limits",
    "photos",
    "galleries",
    "clients",
  );
  await db
    .insert(schema.clients)
    .values({ id: CA, slug: "acme", name: "Acme", pinHash: hash });
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f-" + G,
    slug: "boda",
    title: "Boda secreta",
    status: "published",
    clientId: CA,
    requireEmail: false,
    allowBulk: true,
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

const json = (path: string, body: unknown, cookie = "") =>
  new Request(`${O}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "9.9.9.9",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
async function unlockCookie() {
  const r = await unlockGallery(
    new Request(`${O}/x`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "CF-Connecting-IP": "9.9.9.9",
      },
      body: new URLSearchParams({ pin: PIN }).toString(),
    }),
    "boda",
    e,
  );
  if (r.status !== 303) throw new Error("unlock failed");
  return r.setCookie!.split(";")[0];
}
const tokens = (cookie = "") =>
  handleDownloadTokens(
    json(
      "/api/g/boda/download-tokens",
      { photoIds: ["p1"], variant: "highres" },
      cookie,
    ),
    "boda",
    e,
  );
const dl = async (url: string) =>
  serveDownload(
    new Request(`${O}${url}`, { headers: { "CF-Connecting-IP": "9.9.9.9" } }),
    url.replace("/dl/", ""),
    e,
    {} as never,
  );

describe("T6.52 adversary: client PIN on API routes", () => {
  it("download-tokens, bulk, visitor, favorites and manifest refuse without the client cookie", async () => {
    expect((await tokens()).status).toBe(404);
    expect(
      (
        await handleBulk(
          json("/api/g/boda/bulk", { variant: "highres", scope: "all" }),
          "boda",
          e,
        )
      ).status,
    ).toBe(404);
    expect(
      (await handleVisitor(json("/api/g/boda/visitor", {}), "boda", e)).status,
    ).toBe(404);
    expect(
      (
        await handleListFavorites(
          new Request(`${O}/api/g/boda/favorites`),
          "boda",
          e,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleSetFavorite(
          json("/api/g/boda/favorites", { photoId: "p1", on: true }),
          "boda",
          e,
        )
      ).status,
    ).toBe(404);
    const m = await (
      await handleManifest(new Request(`${O}/m`), "boda", {
        ...e,
        STUDIO_NAME: "S",
      })
    ).text();
    expect(m).not.toContain("Boda secreta");
  });

  it("a download token issued BEFORE the client PIN existed dies when the PIN is set and must stay dead after it is removed", async () => {
    await db.update(schema.clients).set({ pinHash: null });
    const res = await tokens();
    const url = ((await res.json()) as { tokens: { url: string }[] }).tokens[0]
      .url;
    expect((await dl(url)).status).toBe(302);
    await db.update(schema.clients).set({ pinHash: hash });
    expect((await dl(url)).status).toBe(410);
    await db
      .update(schema.clients)
      .set({ pinHash: null })
      .where(eq(schema.clients.id, CA));
    // The owner set the PIN to revoke every outstanding link; removing it again
    // must not resurrect them.
    expect((await dl(url)).status).toBe(410);
  });

  it("a token issued under the client PIN dies when the client is deleted (album becomes unassigned)", async () => {
    const res = await tokens(await unlockCookie());
    const url = ((await res.json()) as { tokens: { url: string }[] }).tokens[0]
      .url;
    expect((await dl(url)).status).toBe(302);
    await db.delete(schema.clients).where(eq(schema.clients.id, CA));
    expect((await dl(url)).status).toBe(410);
  });
});
