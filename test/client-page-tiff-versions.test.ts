import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { executionContext } from "../app/lib/server/context";
import { galleryLoader } from "../app/lib/server/gallery-route";
import { loadClientTiles } from "../app/lib/server/home";
import { migrateDb, resetTables } from "./support/d1";

// T6.53d2: the tile (SQL on the photos mirror) and the back-link flag (open
// payload) must agree. Conservative rule: a versioned Prueba album is never a
// TIFF title-only tile and never gets the flag.
const db = getDb(env);
const e = { ...env, DRIVE_MODE: "mock" } as Env;
const ORIGIN = "https://gallery.381studios.ar";

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("photo_versions", "photos", "galleries", "clients");
  await db.insert(schema.clients).values([
    { id: "c", slug: "acme", name: "ACME" },
    { id: "c2", slug: "keep", name: "Keep" },
  ]);
  // keeps the client page non-null whatever the album under test does
  await db.insert(schema.galleries).values({
    id: "gk",
    driveFolderId: "dk",
    slug: "keeper",
    title: "K",
    status: "published",
    clientId: "c",
  });
  await db.insert(schema.photos).values({
    id: "pk",
    galleryId: "gk",
    baseName: "K",
    driveHighresId: "hk",
    sort: 0,
  });
});

async function seed(mode: "delivery" | "proofing", versioning: boolean) {
  await db.insert(schema.galleries).values({
    id: "g",
    driveFolderId: "d",
    slug: "v",
    title: "V",
    status: "published",
    clientId: "c",
    mode,
    versioning,
  });
  await db.insert(schema.photos).values({
    id: "p",
    galleryId: "g",
    baseName: "A",
    driveHighresId: "TIF",
    driveTiffId: "TIF",
    width: null,
    height: null,
  } as never);
}

async function seedVersions(withImageInV1: boolean) {
  await db.insert(schema.photoVersions).values([
    {
      photoId: "p",
      galleryId: "g",
      version: 1,
      driveHighresId: "HI1",
      driveWebId: withImageInV1 ? "WEB1" : null,
      driveWmId: withImageInV1 ? "WM1" : null,
      driveVersions: "{}",
      firstSeenAt: "2026-03-01T00:00:00.000Z",
    },
    {
      photoId: "p",
      galleryId: "g",
      version: 2,
      driveHighresId: "TIF",
      driveTiffId: "TIF",
      driveVersions: "{}",
      firstSeenAt: "2026-03-02T00:00:00.000Z",
    },
  ] as never);
}

async function both() {
  const tiles = ((await loadClientTiles(e, "acme"))?.tiles ?? []) as {
    slug: string;
    tiffOnly?: boolean;
  }[];
  const c = new RouterContextProvider();
  c.set(executionContext, {
    waitUntil() {},
    passThroughException() {},
  } as never);
  const r = (await galleryLoader(
    {
      request: new Request(`${ORIGIN}/acme/v`, {
        headers: { "Sec-Fetch-Mode": "navigate", Referer: `${ORIGIN}/acme` },
      }),
      context: c,
    } as never,
    { client: "acme", album: "v" },
    e,
  )) as { data: { backToClient?: unknown } };
  return {
    tile: !!tiles.find((t) => t.slug === "v")?.tiffOnly,
    link: !!r.data.backToClient,
  };
}

describe("T6.53d2 tile and back link agree (versions)", () => {
  it.each([
    ["unversioned delivery", "delivery", false, true],
    ["unversioned Prueba", "proofing", false, true],
    ["versioned delivery", "delivery", true, true],
    // SQL would say yes and the payload says no, or the reverse: never listed
    ["versioned Prueba", "proofing", true, false],
  ] as const)(
    "all TIFF, no image: %s -> tile and link %s",
    async (_n, mode, versioning, listed) => {
      await seed(mode, versioning);
      if (versioning) await seedVersions(false);
      expect(await both()).toEqual({ tile: listed, link: listed });
    },
  );

  it("versioned Prueba, v1 has a preview-wm, v2 is TIFF-only: no TIFF tile (the link here comes from the payload's real cover, as before T6.53d2)", async () => {
    await seed("proofing", true);
    await seedVersions(true);
    expect((await both()).tile).toBe(false);
  });

  it("versioned delivery, v1 has a web JPEG, v2 is TIFF-only: neither (the album has an image)", async () => {
    await seed("delivery", true);
    await seedVersions(true);
    const r = await both();
    expect(r.tile).toBe(r.link);
  });
});
