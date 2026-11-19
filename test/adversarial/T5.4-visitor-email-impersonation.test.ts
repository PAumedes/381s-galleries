import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import {
  handleListFavorites,
  handleSetFavorite,
  handleVisitor,
} from "../../app/lib/server/favorites";

const db = getDb(env);
beforeAll(async () => {
  await migrateDb();
});

const post = (path: string, body: unknown, ip: string, cookie?: string) =>
  new Request(`https://s.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const ck = (r: Response) => (r.headers.get("Set-Cookie") ?? "").split(";")[0];

it("a stranger who types the client's email must not inherit their name and favourites", async () => {
  await resetTables(
    "favorites",
    "visitors",
    "rate_limits",
    "photos",
    "galleries",
  );
  await db.insert(schema.galleries).values({
    id: "gV",
    driveFolderId: "f",
    slug: "boda",
    title: "B",
    status: "published",
    requireEmail: true,
  });
  await db.insert(schema.photos).values({
    id: "p1",
    galleryId: "gV",
    baseName: "A",
    driveHighresId: "h",
    sort: 1,
  });
  // The bride registers and picks a favourite.
  const reg = await handleVisitor(
    post(
      "/api/g/boda/visitor",
      { email: "bride@x.com", name: "Alice Bride" },
      "1.1.1.1",
    ),
    "boda",
    env,
  );
  const brideCookie = ck(reg);
  await handleSetFavorite(
    post(
      "/api/g/boda/favorites",
      { photoId: "p1", on: true },
      "1.1.1.1",
      brideCookie,
    ),
    "boda",
    env,
  );

  // A guest on another network just types her email.
  const evil = await handleVisitor(
    post("/api/g/boda/visitor", { email: "bride@x.com" }, "9.9.9.9"),
    "boda",
    env,
  );
  const evilCookie = ck(evil);
  const list = await handleListFavorites(
    new Request("https://s.test/api/g/boda/favorites", {
      headers: { Cookie: evilCookie, "CF-Connecting-IP": "9.9.9.9" },
    }),
    "boda",
    env,
  );
  const body = JSON.stringify(await list.json());
  expect(body).not.toContain("Alice Bride");
  expect(body).not.toContain("p1");
});
