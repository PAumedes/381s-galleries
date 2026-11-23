import { env } from "cloudflare:workers";
import {
  matchRoutes,
  RouterContextProvider,
  type RouteObject,
} from "react-router";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, nowIso, schema } from "../app/db";
import { hashPin } from "../app/lib/server/crypto";
import { executionContext } from "../app/lib/server/context";
import { SLUG_LOADER_D1_QUERIES } from "../app/lib/server/d1-limits";
import { galleryLoader } from "../app/lib/server/gallery-route";
import { handleManifest } from "../app/lib/server/manifest";
import { publicGalleryUrl } from "../app/lib/server/public-url";
import { buildManifest } from "../app/lib/pwa";
import routes from "../app/routes";
import * as clientRoute from "../app/routes/$client.$album";
import * as slugRoute from "../app/routes/$slug";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv } from "./support/warm";

const db = getDb(env);
const e = env as Env;
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
  await db.insert(schema.clients).values([
    { id: "c-acme", slug: "acme", name: "ACME Corp" },
    { id: "c-beta", slug: "beta", name: "Beta" },
  ]);
  const past = nowIso(new Date(Date.now() - 1000));
  const pin = await hashPin("1234");
  const g = (
    slug: string,
    clientId: string | null,
    over: Partial<typeof schema.galleries.$inferInsert> = {},
  ) => ({
    id: `g-${slug}`,
    driveFolderId: `drive-SECRET-${slug}`,
    slug,
    title: `T ${slug}`,
    status: "published" as const,
    clientId,
    ...over,
  });
  const rows = [
    g("pub", "c-acme"),
    g("dra", "c-acme", { status: "draft" }),
    g("arc", "c-acme", { status: "archived" }),
    g("exp", "c-acme", { expiresAt: past }),
    g("pin", "c-acme", { pinHash: pin }),
    g("bpub", "c-beta"),
    g("free", null),
    g("freedraft", null, { status: "draft" }),
  ];
  for (const row of rows) await db.insert(schema.galleries).values(row);
});

const sessionCookie = (h: Headers) =>
  h
    .getSetCookie()
    .find((c) => !c.startsWith("lang="))!
    .split(";")[0]!;
const ctx = () => {
  const c = new RouterContextProvider();
  c.set(executionContext, {
    waitUntil() {},
    passThroughException() {},
  } as never);
  return c;
};
const req = (path: string, init: RequestInit = {}) =>
  new Request(ORIGIN + path, {
    ...init,
    headers: { "Sec-Fetch-Mode": "navigate", ...init.headers },
  });

type Out = {
  status: number;
  location: string | null;
  headers: Headers;
  data?: { state?: string; [k: string]: unknown };
};
async function settle(p: Promise<unknown>): Promise<Out> {
  const r = (await p) as
    Response | { type: string; data: Out["data"]; init: ResponseInit };
  if (r instanceof Response)
    return {
      status: r.status,
      location: r.headers.get("Location"),
      headers: r.headers,
    };
  return {
    status: r.init?.status ?? 200,
    location: null,
    headers: new Headers(r.init?.headers),
    data: r.data,
  };
}
const viaSlug = (path: string, slug: string, init?: RequestInit) =>
  settle(
    slugRoute.loader({
      request: req(path, init),
      params: { slug },
      context: ctx(),
    } as never) as Promise<unknown>,
  );
const viaClient = (
  path: string,
  client: string,
  album: string,
  init?: RequestInit,
) =>
  settle(
    clientRoute.loader({
      request: req(path, init),
      params: { client, album },
      context: ctx(),
    } as never) as Promise<unknown>,
  );

describe("T6.40d /:album redirects to /<client>/<album>", () => {
  it.each([
    ["/pub", "pub", "/acme/pub"],
    ["/pub?lang=en", "pub", "/acme/pub?lang=en"],
    ["/PUB", "PUB", "/acme/pub"],
    ["/pin", "pin", "/acme/pin"],
    ["/bpub", "bpub", "/beta/bpub"],
  ])("%s -> 302 %s", async (path, slug, to) => {
    for (const method of ["GET", "HEAD"]) {
      const r = await viaSlug(path, slug, { method });
      expect(r.status, method).toBe(302);
      expect(r.location, method).toBe(to);
      expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });

  it.each(["dra", "arc", "exp", "freedraft", "nope", "acme", "a.png"])(
    "/%s never redirects: identical 404 without the client slug",
    async (slug) => {
      const r = await viaSlug("/" + slug, slug);
      expect(r.status).toBe(404);
      expect(r.location).toBeNull();
      expect(r.data).toEqual({ state: "unavailable", origin: ORIGIN });
    },
  );

  it("an unassigned available album is served in place", async () => {
    const r = await viaSlug("/free", "free");
    expect(r.status).toBe(200);
    expect(r.data?.state).toBe("open");
  });

  it("redirect response header snapshot", async () => {
    const r = await viaSlug("/pub", "pub");
    expect(Object.fromEntries([...r.headers].sort())).toEqual({
      "cache-control": "private, no-store",
      location: "/acme/pub",
      "referrer-policy": "same-origin",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-robots-tag": "noindex, nofollow",
    });
  });

  it("?lang on a redirect still sets the language cookie", async () => {
    const r = await viaSlug("/pub?lang=en", "pub");
    expect(r.headers.get("Set-Cookie")).toMatch(/lang=en/);
  });
});

describe("T6.40d /<client>/<album>", () => {
  it.each([
    ["/acme/pub", "acme", "pub", 200, null],
    ["/ACME/Pub", "ACME", "Pub", 200, null],
    ["/acme/pub/?lang=en", "acme", "pub", 200, null],
    // wrong or unknown client, available album: canonical URL
    ["/beta/pub", "beta", "pub", 302, "/acme/pub"],
    ["/nobody/pub", "nobody", "pub", 302, "/acme/pub"],
    ["/beta/pub?lang=en", "beta", "pub", 302, "/acme/pub?lang=en"],
    ["/acme/free", "acme", "free", 302, "/free"],
    ["/nobody/free?lang=en", "nobody", "free", 302, "/free?lang=en"],
    ["/acme/bpub", "acme", "bpub", 302, "/beta/bpub"],
    // unavailable albums: 404 whatever the client (no leak)
    ["/acme/dra", "acme", "dra", 404, null],
    ["/beta/dra", "beta", "dra", 404, null],
    ["/acme/arc", "acme", "arc", 404, null],
    ["/acme/exp", "acme", "exp", 404, null],
    ["/acme/freedraft", "acme", "freedraft", 404, null],
    ["/acme/nope", "acme", "nope", 404, null],
    ["/acme/x.png", "acme", "x.png", 404, null],
    // reserved / file-like client segment: 404 even for an available album
    ["/admin/pub", "admin", "pub", 404, null],
    ["/img/free", "img", "free", 404, null],
    ["/api/pub", "api", "pub", 404, null],
    ["/favicon.ico/pub", "favicon.ico", "pub", 404, null],
  ])("%s -> %i %s", async (path, client, album, status, to) => {
    for (const method of ["GET", "HEAD"]) {
      const r = await viaClient(path, client, album, { method });
      expect(r.status, `${method} ${path}`).toBe(status);
      expect(r.location).toBe(to);
      expect(r.headers.get("Cache-Control")).toBe("private, no-store");
      if (status === 200) expect(r.data?.state).toBe("open");
      if (status === 404)
        expect(r.data).toEqual({ state: "unavailable", origin: ORIGIN });
    }
  });

  it("the open page carries the canonical client slug, unavailable never does", async () => {
    const ok = await viaClient("/acme/pub", "acme", "pub");
    expect(ok.data?.clientSlug).toBe("acme");
    expect(JSON.stringify(ok.data)).not.toContain("SECRET");
    const free = await viaSlug("/free", "free");
    expect(free.data?.clientSlug).toBeUndefined();
    const no = await viaClient("/acme/dra", "acme", "dra");
    expect(JSON.stringify(no.data)).not.toContain("acme");
  });

  it("PIN album: locked form on the client URL, no photos", async () => {
    const r = await viaClient("/acme/pin", "acme", "pin");
    expect(r.status).toBe(200);
    expect(r.data?.state).toBe("locked");
  });
});

describe("T6.40d PIN flow on both URLs", () => {
  const post = (path: string, pin: string) => {
    const body = new FormData();
    body.set("pin", pin);
    return req(path, {
      method: "POST",
      body,
      headers: { "CF-Connecting-IP": "203.0.113.7" },
    });
  };
  const slugAction = (path: string, slug: string, pin: string) =>
    settle(
      slugRoute.action({
        request: post(path, pin),
        params: { slug },
        context: ctx(),
      } as never) as Promise<unknown>,
    );
  const clientAction = (
    path: string,
    client: string,
    album: string,
    pin: string,
  ) =>
    settle(
      clientRoute.action({
        request: post(path, pin),
        params: { client, album },
        context: ctx(),
      } as never) as Promise<unknown>,
    );

  it("POST on the client URL unlocks and 303s to the same canonical URL", async () => {
    const r = await clientAction("/acme/pin", "acme", "pin", "1234");
    expect(r.status).toBe(303);
    expect(r.location).toBe("/acme/pin");
    const cookie = sessionCookie(r.headers);
    const open = await viaClient("/acme/pin", "acme", "pin", {
      headers: { Cookie: cookie },
    });
    expect(open.data?.state).toBe("open");
  });

  it("POST on /:album also unlocks and 303s to the canonical URL, ?lang kept", async () => {
    const r = await slugAction("/pin?lang=en", "pin", "1234");
    expect(r.status).toBe(303);
    expect(r.location).toBe("/acme/pin?lang=en");
    // the unlock cookie (scoped by album) opens the canonical page
    const cookie = sessionCookie(r.headers);
    const open = await viaClient("/acme/pin", "acme", "pin", {
      headers: { Cookie: cookie },
    });
    expect(open.data?.state).toBe("open");
  });

  it("wrong PIN is 400 on both URLs", async () => {
    expect(
      (await clientAction("/acme/pin", "acme", "pin", "0000")).status,
    ).toBe(400);
    expect((await slugAction("/pin", "pin", "0000")).status).toBe(400);
  });

  it("POST with a wrong client is 404 (never unlocks, never redirects)", async () => {
    const r = await clientAction("/beta/pin", "beta", "pin", "1234");
    expect(r.status).toBe(404);
    expect(r.headers.get("Set-Cookie")).toBeNull();
    expect(
      (await clientAction("/admin/pin", "admin", "pin", "1234")).status,
    ).toBe(404);
  });

  it("an unassigned album keeps its plain /<slug> location", async () => {
    await db
      .update(schema.galleries)
      .set({ pinHash: await hashPin("9") })
      .where((await import("drizzle-orm")).eq(schema.galleries.slug, "free"));
    const r = await slugAction("/free", "free", "9");
    expect(r.location).toBe("/free");
  });
});

describe("T6.40d canonical URL in meta, manifest and helper", () => {
  it("publicGalleryUrl", () => {
    const q = new Request(ORIGIN + "/x");
    expect(publicGalleryUrl({}, q, "pub")).toBe(`${ORIGIN}/pub`);
    expect(publicGalleryUrl({}, q, "pub", "acme")).toBe(`${ORIGIN}/acme/pub`);
    expect(publicGalleryUrl({}, q, "pub", null)).toBe(`${ORIGIN}/pub`);
  });

  it("og:url uses the client address; the manifest link stays slug-keyed", async () => {
    const r = await viaClient("/acme/pub", "acme", "pub");
    const tags = clientRoute.meta({
      loaderData: r.data,
      matches: [],
    } as never) as Record<string, string>[];
    expect(tags.find((t) => t.property === "og:url")?.content).toBe(
      `${ORIGIN}/acme/pub`,
    );
    expect(tags.find((t) => t.rel === "manifest")?.href).toBe(
      "/api/g/pub/manifest.webmanifest",
    );
    const f = await viaSlug("/free", "free");
    const ft = slugRoute.meta({
      loaderData: f.data,
      matches: [],
    } as never) as Record<string, string>[];
    expect(ft.find((t) => t.property === "og:url")?.content).toBe(
      `${ORIGIN}/free`,
    );
  });

  it("buildManifest scopes to the client address", () => {
    const m = buildManifest({
      studio: "S",
      gallery: {
        slug: "pub",
        clientSlug: "acme",
        title: "T",
        palette: "claro",
      },
    });
    expect(m).toMatchObject({
      id: "/acme/pub",
      start_url: "/acme/pub/?source=pwa",
      scope: "/acme/pub/",
    });
    expect(
      buildManifest({
        studio: "S",
        gallery: { slug: "pub", title: "T", palette: "claro" },
      }),
    ).toMatchObject({
      id: "/pub",
      start_url: "/pub/?source=pwa",
      scope: "/pub/",
    });
  });

  const manifest = async (slug: string) =>
    (
      await handleManifest(req(`/api/g/${slug}/manifest.webmanifest`), slug, e)
    ).json() as Promise<Record<string, string>>;

  it("handleManifest: assigned, PIN, unassigned and unavailable", async () => {
    expect(await manifest("pub")).toMatchObject({
      name: "T pub",
      scope: "/acme/pub/",
      start_url: "/acme/pub/?source=pwa",
    });
    expect(await manifest("pin")).toMatchObject({ scope: "/acme/pin/" });
    expect((await manifest("pin")).name).not.toContain("T pin");
    expect(await manifest("free")).toMatchObject({ scope: "/free/" });
    const generic = await manifest("nope");
    expect(generic.start_url).toBe("/");
    for (const s of ["dra", "arc", "exp", "freedraft"])
      expect(await manifest(s)).toEqual(generic);
  });
});

describe("T6.40d router ranking", () => {
  type Conf = {
    path?: string;
    index?: boolean;
    file: string;
    children?: Conf[];
  };
  const toObj = (r: Conf): RouteObject =>
    ({
      id: r.file,
      path: r.path,
      index: r.index,
      children: r.children?.map(toObj),
    }) as RouteObject;
  const tree = (routes as unknown as Conf[]).map(toObj);
  const leaf = (p: string) => {
    const m = matchRoutes(tree, p);
    return m ? m[m.length - 1]!.route.id : null;
  };

  it.each([
    ["/admin/setup", "routes/admin.setup.tsx"],
    ["/admin/g/abc", "routes/admin.g.$id.tsx"],
    ["/admin/g/abc/preview", "routes/admin.g.$id.preview.tsx"],
    ["/admin/google/connect", "routes/admin.google.connect.tsx"],
    ["/dl/xyz", "routes/dl.$token.tsx"],
    ["/api/admin/sync", "routes/api.admin.sync.tsx"],
    ["/api/g/s/manifest.webmanifest", "routes/api.g.$slug.manifest.tsx"],
    ["/api/g/s/favorites", "routes/api.g.$slug.favorites.tsx"],
    ["/img/p/web", "routes/img.$photoId.$variant.tsx"],
    ["/brand/logo/dark", "routes/brand.logo.$variant.tsx"],
    ["/acme/pub", "routes/$client.$album.tsx"],
    ["/acme/pub/", "routes/$client.$album.tsx"],
    ["/ACME/Pub", "routes/$client.$album.tsx"],
    ["/pub", "routes/$slug.tsx"],
    ["/privacy", "routes/privacy.tsx"],
    ["/admin/nope", "routes/$client.$album.tsx"],
    ["/api/nope", "routes/$client.$album.tsx"],
  ])("%s -> %s", (p, id) => expect(leaf(p)).toBe(id));

  it("three segments match nothing", () => {
    expect(leaf("/a/b/c")).toBeNull();
  });

  it("the album route's params are named client and album", () => {
    const m = matchRoutes(tree, "/acme/pub")!;
    expect(m[0]!.params).toEqual({ client: "acme", album: "pub" });
  });
});

describe("T6.40d D1 cost and caching", () => {
  const run = (path: string, target: { client?: string; album: string }) => {
    const c = countingEnv(e);
    const done = galleryLoader(
      { request: req(path), context: ctx() } as never,
      target,
      c.e,
    );
    return done.then(() => c.count());
  };

  it("a redirect or 404 costs one query, a reserved client none", async () => {
    expect(await run("/pub", { album: "pub" })).toBe(1);
    expect(await run("/beta/pub", { client: "beta", album: "pub" })).toBe(1);
    expect(await run("/acme/dra", { client: "acme", album: "dra" })).toBe(1);
    expect(await run("/admin/pub", { client: "admin", album: "pub" })).toBe(0);
  });

  it("an open client-URL page stays within the documented loader budget", async () => {
    const n = await run("/acme/pub", { client: "acme", album: "pub" });
    expect(n).toBeLessThanOrEqual(SLUG_LOADER_D1_QUERIES);
    // the same page without a client costs no more than before this task: the
    // client slug rides on the gallery lookup (a join), not a second query
    const plain = await run("/free", { album: "free" });
    expect(n).toBe(plain);
  });

  it("page responses stay no-store; image URLs do not depend on the page URL", async () => {
    await db.insert(schema.photos).values({
      id: "p1",
      galleryId: "g-pub",
      baseName: "IMG_1",
      driveHighresId: "HI-SECRET",
      driveWebId: "WEB-SECRET",
      width: 3000,
      height: 2000,
    });
    const r = await viaClient("/acme/pub", "acme", "pub");
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(r.headers.get("ETag")).toBeNull();
    const photos = (r.data as unknown as { photos: { id: string }[] }).photos;
    expect(photos.map((p) => p.id)).toEqual(["p1"]);
    expect(JSON.stringify(r.data)).not.toMatch(/SECRET|c-acme/);
  });
});
