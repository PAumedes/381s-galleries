import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { executionContext } from "../../app/lib/server/context";
import { galleryLoader } from "../../app/lib/server/gallery-route";
import { CLIENT_CANDIDATE_CAP } from "../../app/lib/server/home";
import { migrateDb, resetTables } from "../support/d1";

const db = getDb(env);
const e = env as Env;

async function load(path: string) {
  const c = new RouterContextProvider();
  c.set(executionContext, {
    waitUntil() {},
    passThroughException() {},
  } as never);
  const r = (await galleryLoader(
    {
      request: new Request("https://gallery.381studios.ar" + path, {
        headers: { "Sec-Fetch-Mode": "navigate" },
      }),
      context: c,
    } as never,
    { album: path.slice(1).split("?")[0] },
    e,
  )) as {
    data: { state?: string; items?: { slug: string }[] };
    init: ResponseInit;
  };
  return { status: r.init?.status ?? 200, data: r.data };
}

async function seed(n: number, mk: (i: number) => Record<string, unknown>) {
  for (let i = 0; i < n; i += 50) {
    const stmts = [];
    for (let j = i; j < Math.min(n, i + 50); j++)
      stmts.push(
        db.insert(schema.galleries).values({
          id: `g${j}`,
          driveFolderId: `d${j}`,
          slug: `x${String(j).padStart(4, "0")}`,
          title: `T${j}`,
          status: "published",
          clientId: "c1",
          // index 0 newest
          eventDate: new Date(Date.UTC(2026, 0, 1) - j * 86_400_000)
            .toISOString()
            .slice(0, 10),
          ...mk(j),
        }),
      );
    await db.batch(stmts as never);
  }
}

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("photos", "galleries", "clients");
  await db
    .insert(schema.clients)
    .values({ id: "c1", slug: "acme", name: "ACME" });
});

describe("T6.49 candidate cap is applied before the cover/expiry filter", () => {
  it("1000 newer albums without a cover must not hide an older album that has one", async () => {
    const N = CLIENT_CANDIDATE_CAP + 1;
    await seed(N, () => ({}));
    await db.insert(schema.photos).values({
      id: "p-old",
      galleryId: `g${N - 1}`,
      baseName: "old",
      driveHighresId: "hr",
      sort: 0,
    });
    const r = await load("/acme");
    // admin's listedOnClientPage counts it as visible (1); the public page 404s
    expect(r.status).toBe(200);
    expect(r.data.items?.map((i) => i.slug)).toEqual([
      `x${String(N - 1).padStart(4, "0")}`,
    ]);
  }, 60_000);

  it("1000 newer expired albums must not hide an older live one", async () => {
    const N = CLIENT_CANDIDATE_CAP + 1;
    await seed(N, (j) => ({
      expiresAt: j < N - 1 ? "2020-01-01T00:00:00.000Z" : null,
    }));
    for (let i = 0; i < N; i += 10)
      await db.insert(schema.photos).values(
        Array.from({ length: Math.min(10, N - i) }, (_, k) => ({
          id: `p${i + k}`,
          galleryId: `g${i + k}`,
          baseName: `b${i + k}`,
          driveHighresId: `hr${i + k}`,
          sort: 0,
        })),
      );
    const r = await load("/acme");
    expect(r.status).toBe(200);
  }, 60_000);
});
