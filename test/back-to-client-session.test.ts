import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { hashPin } from "../app/lib/server/crypto";
import { executionContext } from "../app/lib/server/context";
import { SLUG_LOADER_D1_QUERIES } from "../app/lib/server/d1-limits";
import { galleryAction, galleryLoader } from "../app/lib/server/gallery-route";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv } from "./support/warm";

// T6.54 (5): a visitor who reached an album from the client page keeps the
// back link through the steps that lose the Referer (PIN POST + redirect
// without JS, reload, language switch): a short-lived signed cookie, set only
// when a valid Referer granted the link. Direct (shared) links learn nothing.
const db = getDb(env);
const e = { ...env, DRIVE_MODE: "mock" } as Env;
const ORIGIN = "https://gallery.381studios.ar";
const OWN_PIN = "own-album-pin";
const CLIENT_PIN = "client-pin-1";

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables(
    "gallery_views",
    "rate_limits",
    "photos",
    "galleries",
    "clients",
  );
  await db.insert(schema.clients).values([
    { id: "c-acme", slug: "acme", name: "ACME Corp" },
    { id: "c-beta", slug: "beta", name: "Beta" },
    { id: "c-off", slug: "off", name: "Off Client", pageEnabled: false },
    {
      id: "c-pc",
      slug: "pc",
      name: "PIN Client",
      pinHash: await hashPin(CLIENT_PIN),
    },
  ]);
  const own = await hashPin(OWN_PIN);
  const albums: [
    string,
    string | null,
    Partial<typeof schema.galleries.$inferInsert>,
    boolean,
  ][] = [
    ["pub", "c-acme", {}, true],
    ["other", "c-acme", {}, true],
    ["nocover", "c-acme", {}, false],
    ["dra", "c-acme", { status: "draft" }, true],
    ["pin", "c-acme", { pinHash: own }, false],
    ["bpub", "c-beta", {}, true],
    ["offpub", "c-off", {}, true],
    ["pcalb", "c-pc", {}, true],
    ["free", null, {}, true],
  ];
  for (const [slug, clientId, over, photo] of albums) {
    await db.insert(schema.galleries).values({
      id: `g-${slug}`,
      driveFolderId: `drive-SECRET-${slug}`,
      slug,
      title: `T ${slug}`,
      status: "published",
      clientId,
      ...over,
    });
    if (photo)
      await db.insert(schema.photos).values({
        id: `p-${slug}`,
        galleryId: `g-${slug}`,
        baseName: "IMG",
        driveHighresId: `hr-${slug}`,
        driveWmId: `wm-${slug}`,
        sort: 0,
        width: 300,
        height: 200,
      });
  }
});

const ctx = () => {
  const c = new RouterContextProvider();
  c.set(executionContext, {
    waitUntil() {},
    passThroughException() {},
  } as never);
  return c;
};
type Res = { data: Record<string, unknown>; init: { headers: Headers } };
async function load(
  client: string | undefined,
  album: string,
  opts: { referer?: string; cookie?: string; env?: Env } = {},
): Promise<{ data: Record<string, unknown>; cookies: string[] }> {
  const headers: Record<string, string> = { "Sec-Fetch-Mode": "navigate" };
  if (opts.referer !== undefined) headers.Referer = opts.referer;
  if (opts.cookie) headers.Cookie = opts.cookie;
  const path = client ? `/${client}/${album}` : `/${album}`;
  const r = (await galleryLoader(
    {
      request: new Request(ORIGIN + path, { headers }),
      context: ctx(),
    } as never,
    client ? { client, album } : { album },
    opts.env ?? e,
  )) as Res;
  return { data: r.data, cookies: r.init.headers.getSetCookie() };
}
const backCookies = (c: string[]) => c.filter((x) => x.startsWith("b_"));
const pair = (setCookie: string) => setCookie.split(";")[0];
const REF = `${ORIGIN}/acme`;
const link = (d: Record<string, unknown>) =>
  d.backToClient as { name: string; href: string } | undefined;

describe("T6.54 (5) back link cookie: set only by a valid Referer", () => {
  it("a Referer from the client page grants the link and sets one HttpOnly, SameSite=Lax, 1 h cookie", async () => {
    const r = await load("acme", "pub", { referer: `${REF}?pagina=2` });
    expect(link(r.data)).toEqual({ name: "ACME Corp", href: "/acme?pagina=2" });
    const [c] = backCookies(r.cookies);
    expect(backCookies(r.cookies)).toHaveLength(1);
    expect(c).toMatch(/^b_cacme=/);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Lax/);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/Max-Age=3600\b/);
    // opaque: no name, slug or PIN data readable in the value
    const val = decodeURIComponent(c.split("=")[1].split(";")[0]);
    const payload = atob(
      val.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"),
    );
    for (const s of ["ACME Corp", "pbkdf2", "SECRET"])
      expect(payload).not.toContain(s);
  });

  it("a direct open (shared link) has no link and sets no cookie", async () => {
    const r = await load("acme", "pub");
    expect(link(r.data)).toBeUndefined();
    expect(backCookies(r.cookies)).toEqual([]);
  });

  it.each([
    ["other origin", "https://evil.com/acme"],
    ["another client's page", `${ORIGIN}/beta`],
    ["the album itself", `${ORIGIN}/acme/pub`],
  ])(
    "a Referer that is not this client's page (%s) sets no cookie",
    async (_n, referer) => {
      const r = await load("acme", "pub", { referer });
      expect(link(r.data)).toBeUndefined();
      expect(backCookies(r.cookies)).toEqual([]);
    },
  );

  it.each([
    ["draft (unavailable)", "dra"],
    ["no cover and no PIN (not on the client page)", "nocover"],
  ])(
    "a forged Referer on an album the client page does not list: %s -> no cookie",
    async (_n, album) => {
      const r = await load("acme", album, { referer: REF });
      expect(link(r.data)).toBeUndefined();
      expect(backCookies(r.cookies)).toEqual([]);
    },
  );

  it("a disabled client page never grants it", async () => {
    const r = await load("off", "offpub", { referer: `${ORIGIN}/off` });
    expect(link(r.data)).toBeUndefined();
    expect(backCookies(r.cookies)).toEqual([]);
  });

  it("an unassigned album never grants it", async () => {
    const r = await load(undefined, "free", { referer: REF });
    expect(link(r.data)).toBeUndefined();
    expect(backCookies(r.cookies)).toEqual([]);
  });
});

describe("T6.54 (5) the cookie keeps the link when the Referer is lost", () => {
  async function granted(album = "pub", referer = REF) {
    const r = await load("acme", album, { referer });
    return pair(backCookies(r.cookies)[0]);
  }
  it("no Referer (reload) + cookie: link, same page number, no new cookie", async () => {
    const c = await granted("pub", `${REF}?pagina=3`);
    const r = await load("acme", "pub", { cookie: c });
    expect(link(r.data)).toEqual({ name: "ACME Corp", href: "/acme?pagina=3" });
    expect(backCookies(r.cookies)).toEqual([]);
  });
  it("Referer = the album itself (language toggle / PIN redirect) + cookie: link kept", async () => {
    const c = await granted();
    const r = await load("acme", "pub", {
      referer: `${ORIGIN}/acme/pub`,
      cookie: c,
    });
    expect(link(r.data)?.href).toBe("/acme");
  });
  it("the cookie is per client: another album of the same client shows it, an album of another client does not", async () => {
    const c = await granted();
    expect(link((await load("acme", "other", { cookie: c })).data)?.name).toBe(
      "ACME Corp",
    );
    expect(
      link((await load("beta", "bpub", { cookie: c })).data),
    ).toBeUndefined();
  });
  it("still obeys the listing rules: a draft, a cover-less open album, a disabled page", async () => {
    const c = await granted();
    expect((await load("acme", "dra", { cookie: c })).data.state).toBe(
      "unavailable",
    );
    expect(
      link((await load("acme", "nocover", { cookie: c })).data),
    ).toBeUndefined();
    const name = c.split("=")[0];
    expect(
      link(
        (await load("off", "offpub", { cookie: `${name}=${c.split("=")[1]}` }))
          .data,
      ),
    ).toBeUndefined();
  });
  it("an album moved to another client or unassigned drops it", async () => {
    const c = await granted();
    await db
      .update(schema.galleries)
      .set({ clientId: "c-beta" })
      .where(eqId("g-pub"));
    expect(
      link((await load("beta", "pub", { cookie: c })).data),
    ).toBeUndefined();
    await db
      .update(schema.galleries)
      .set({ clientId: null })
      .where(eqId("g-pub"));
    expect(
      link((await load(undefined, "pub", { cookie: c })).data),
    ).toBeUndefined();
  });
  it("a cookie of client A under client B's cookie name, a tampered one and garbage give nothing", async () => {
    const c = await granted();
    const value = c.split("=")[1];
    const bName = "b_cbeta";
    for (const cookie of [
      `${bName}=${value}`,
      `${c}x`,
      `${c.split("=")[0]}=garbage`,
      `${c.split("=")[0]}=a.b`,
      `${c.split("=")[0]}=`,
    ])
      expect(
        link((await load("beta", "bpub", { cookie })).data),
      ).toBeUndefined();
    expect(
      link((await load("acme", "pub", { cookie: `${c}x` })).data),
    ).toBeUndefined();
  });
  it("a cookie older than its hour is worthless", async () => {
    const c = await granted();
    const real = Date.now;
    Date.now = () => real() + 3601 * 1000;
    try {
      expect(
        link((await load("acme", "pub", { cookie: c })).data),
      ).toBeUndefined();
    } finally {
      Date.now = real;
    }
  });
});

describe("T6.54 (5) PIN albums: the unlock without JS (POST + 303 + GET) keeps the link", () => {
  it("own PIN: gate with Referer -> POST (Referer = the album) -> GET with the cookie shows the link", async () => {
    const gate = await load("acme", "pin", { referer: REF });
    expect(gate.data.state).toBe("locked");
    expect(link(gate.data)?.name).toBe("ACME Corp");
    const back = pair(backCookies(gate.cookies)[0]);
    const res = (await galleryAction(
      {
        request: new Request(`${ORIGIN}/acme/pin`, {
          method: "POST",
          headers: {
            Referer: `${ORIGIN}/acme/pin`,
            Cookie: back,
            "Content-Type": "application/x-www-form-urlencoded",
            "CF-Connecting-IP": "203.0.113.5",
            "Sec-Fetch-Site": "same-origin",
          },
          body: new URLSearchParams({ pin: OWN_PIN }).toString(),
        }),
      },
      { album: "pin", client: "acme" },
      e,
    )) as Response;
    expect(res.status).toBe(303);
    const session = pair(
      res.headers.getSetCookie().find((x) => x.startsWith("g_"))!,
    );
    // the redirected GET: Referer is the album's own URL
    const after = await load("acme", "pin", {
      referer: `${ORIGIN}/acme/pin`,
      cookie: `${back}; ${session}`,
    });
    expect(after.data.state).toBe("open");
    expect(link(after.data)).toEqual({ name: "ACME Corp", href: "/acme" });
  });

  it("client PIN: the gate of a PIN client reached from its page carries the link and the cookie", async () => {
    const gate = await load("pc", "pcalb", { referer: `${ORIGIN}/pc` });
    expect(gate.data).toMatchObject({ state: "locked", step: "client" });
    expect(link(gate.data)?.name).toBe("PIN Client");
    expect(backCookies(gate.cookies)).toHaveLength(1);
  });
});

describe("T6.54 (5) cost", () => {
  it("the cookie path adds no D1 query (with Referer, with cookie only, direct)", async () => {
    const first = await load("acme", "pub", { referer: REF });
    const c = pair(backCookies(first.cookies)[0]);
    const count = async (opts: { referer?: string; cookie?: string }) => {
      const k = countingEnv(e);
      await load("acme", "pub", { ...opts, env: k.e });
      return k.count();
    };
    const direct = await count({});
    expect(await count({ referer: REF })).toBe(direct);
    expect(await count({ cookie: c })).toBe(direct);
    expect(direct).toBeLessThanOrEqual(SLUG_LOADER_D1_QUERIES);
  });
});

const eqId = (id: string) => eq(schema.galleries.id, id);
