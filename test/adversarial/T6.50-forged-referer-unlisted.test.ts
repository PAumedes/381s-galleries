import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { executionContext } from "../../app/lib/server/context";
import { galleryLoader } from "../../app/lib/server/gallery-route";
import { migrateDb, resetTables } from "../support/d1";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "mock" } as Env;
const ORIGIN = "https://gallery.381studios.ar";
beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables(
    "gallery_views",
    "rate_limits",
    "photos",
    "galleries",
    "clients",
  );
  await db
    .insert(schema.clients)
    .values({ id: "c", slug: "acme", name: "ACME Secret Name" });
  // published, open, but NOT listed on the client page (no cover, no PIN)
  await db.insert(schema.galleries).values({
    id: "g",
    driveFolderId: "d",
    slug: "pub",
    title: "T",
    status: "published",
    clientId: "c",
  });
});
const ctx = () => {
  const c = new RouterContextProvider();
  c.set(executionContext, {
    waitUntil() {},
    passThroughException() {},
  } as never);
  return c;
};
async function load(
  client: string | undefined,
  album: string,
  referer?: string,
) {
  const headers: Record<string, string> = { "Sec-Fetch-Mode": "navigate" };
  if (referer) headers.Referer = referer;
  const r = (await galleryLoader(
    {
      request: new Request(`${ORIGIN}/${client ? client + "/" : ""}${album}`, {
        headers,
      }),
      context: ctx(),
    } as never,
    client ? { client, album } : { album },
    e,
  )) as { data: Record<string, unknown> };
  return r.data;
}

describe("T6.50 forged Referer reveals name of a client whose page is not public", () => {
  it("client page /acme is a 404 (no listed album) yet a forged Referer yields the client name", async () => {
    const page = await load(undefined, "acme");
    expect(page.state).toBe("unavailable"); // /acme is not a public page
    const d = await load("acme", "pub", `${ORIGIN}/acme`);
    expect(JSON.stringify(d)).not.toContain("ACME Secret Name");
  });
});
