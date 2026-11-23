import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { executionContext } from "../../app/lib/server/context";
import { galleryLoader } from "../../app/lib/server/gallery-route";
import { migrateDb, resetTables } from "../support/d1";

const db = getDb(env);
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
    .values({ id: "c-k", slug: "kilo", name: "Kilo" });
  await db.insert(schema.galleries).values({
    id: "g-kp",
    driveFolderId: "d",
    slug: "kpub",
    title: "T",
    status: "published",
    clientId: "c-k",
  });
});

// JS toLowerCase maps U+212A (Kelvin sign) to "k"; SQL NOCASE is ASCII-only.
// The client segment must be compared the way the DB does, so a look-alike
// segment is a non-canonical URL and gets a 302 to /kilo/kpub.
it("a Kelvin-sign client segment is not treated as the album's client", async () => {
  const c = new RouterContextProvider();
  c.set(executionContext, {
    waitUntil() {},
    passThroughException() {},
  } as never);
  const r = (await galleryLoader(
    {
      request: new Request("https://gallery.381studios.ar/%E2%84%AAilo/kpub", {
        headers: { "Sec-Fetch-Mode": "navigate" },
      }),
      context: c,
    },
    { client: "Kilo", album: "kpub" },
    env as Env,
  )) as Response;
  // a served page comes back as data(), a redirect as a Response
  expect(r instanceof Response, "served in place at a non-canonical URL").toBe(
    true,
  );
  expect(r.status).toBe(302);
  expect(r.headers.get("Location")).toBe("/kilo/kpub");
});
