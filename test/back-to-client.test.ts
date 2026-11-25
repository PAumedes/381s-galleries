import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { hashPin } from "../app/lib/server/crypto";
import { executionContext } from "../app/lib/server/context";
import { SLUG_LOADER_D1_QUERIES } from "../app/lib/server/d1-limits";
import { galleryLoader } from "../app/lib/server/gallery-route";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv } from "./support/warm";

// T6.50: the "back to the client page" link travels in the album payload only
// when the Referer is that client's own page (same origin, exact path).
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
  await db.insert(schema.clients).values([
    { id: "c-acme", slug: "acme", name: "ACME Corp" },
    { id: "c-beta", slug: "beta", name: "Beta" },
    { id: "c-off", slug: "off", name: "Off Client", pageEnabled: false },
  ]);
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
  for (const row of [
    g("pub", "c-acme"),
    g("other", "c-acme"),
    g("dra", "c-acme", { status: "draft" }),
    g("pin", "c-acme", { pinHash: pin }),
    g("bpub", "c-beta"),
    g("offpub", "c-off"),
    g("free", null),
  ])
    await db.insert(schema.galleries).values(row);
  // A cover (any visible photo) makes an open album listed on the client page.
  for (const id of ["g-pub", "g-other", "g-bpub", "g-offpub", "g-free"])
    await seedPhotos(id, 1);
});

/** One visible photo (a cover) for an album; `wm: false` = no preview-wm. */
async function seedPhotos(galleryId: string, n: number, wm = true) {
  for (let i = 0; i < n; i++)
    await db.insert(schema.photos).values({
      id: `${galleryId}-p${i}`,
      galleryId,
      baseName: `IMG_${i}`,
      driveHighresId: `hr-${galleryId}-${i}`,
      driveWmId: wm ? `wm-${galleryId}-${i}` : null,
      sort: i,
      width: 300,
      height: 200,
    });
}

const ctx = () => {
  const c = new RouterContextProvider();
  c.set(executionContext, {
    waitUntil() {},
    passThroughException() {},
  } as never);
  return c;
};
type Payload = { state?: string; backToClient?: unknown; [k: string]: unknown };
async function load(
  client: string | undefined,
  album: string,
  referer?: string,
  extra: Record<string, string> = {},
  env_: Env = e,
): Promise<Payload> {
  const headers: Record<string, string> = {
    "Sec-Fetch-Mode": "navigate",
    ...extra,
  };
  if (referer !== undefined) headers.Referer = referer;
  const path = client ? `/${client}/${album}` : `/${album}`;
  const r = (await galleryLoader(
    {
      request: new Request(ORIGIN + path, { headers }),
      context: ctx(),
    } as never,
    client ? { client, album } : { album },
    env_,
  )) as { data: Payload };
  return r.data;
}
const acme = (referer?: string, extra?: Record<string, string>) =>
  load("acme", "pub", referer, extra);

describe("T6.50 back-to-client link: Referer from the client's own page", () => {
  it.each([
    [`${ORIGIN}/acme`, "/acme"],
    [`${ORIGIN}/ACME`, "/acme"],
    [`${ORIGIN}/AcMe`, "/acme"],
    [`${ORIGIN}/acme?pagina=3`, "/acme?pagina=3"],
    [`${ORIGIN}/acme?pagina=1`, "/acme"],
    [`${ORIGIN}/acme?lang=en&pagina=2`, "/acme?pagina=2"],
    [`${ORIGIN}/acme?x=1`, "/acme"],
    [`${ORIGIN}/acme#top`, "/acme"],
    [`${ORIGIN}/acme?pagina=abc`, "/acme"],
    [`${ORIGIN}/acme?pagina=0`, "/acme"],
    [`${ORIGIN}/acme?pagina=-2`, "/acme"],
    [`${ORIGIN}/acme?pagina=02`, "/acme"],
    [`${ORIGIN}/acme?pagina=2.5`, "/acme"],
    [`${ORIGIN}/acme?pagina=1&pagina=2`, "/acme"],
    [`${ORIGIN}/acme?pagina=`, "/acme"],
    [`${ORIGIN}/acme?pagina=${"9".repeat(400)}`, "/acme"],
    [`${ORIGIN}/acme?pagina=99999`, "/acme"],
  ])("Referer %s -> link to %s", async (referer, href) => {
    const d = await acme(referer);
    expect(d.state).toBe("open");
    expect(d.backToClient).toEqual({ name: "ACME Corp", href });
  });

  it("a client-side navigation (.data fetch, cors mode, page URL as Referer) gets it too", async () => {
    const d = await acme(`${ORIGIN}/acme?pagina=2`, {
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
    });
    expect(d.backToClient).toEqual({
      name: "ACME Corp",
      href: "/acme?pagina=2",
    });
  });

  it("a locked (PIN) album carries it too, so it survives the unlock (the page never shows it on the gate)", async () => {
    const d = await load("acme", "pin", `${ORIGIN}/acme`);
    expect(d.state).toBe("locked");
    expect(d.backToClient).toEqual({ name: "ACME Corp", href: "/acme" });
  });
});

describe("T6.50 no link otherwise", () => {
  it.each([
    ["no Referer", undefined],
    ["empty", ""],
    ["not a URL", "not a url"],
    ["other origin", "https://evil.com/acme"],
    ["suffix host", "https://gallery.381studios.ar.evil.com/acme"],
    ["prefix host", "https://evilgallery.381studios.ar/acme"],
    ["userinfo to evil", "https://gallery.381studios.ar@evil.com/acme"],
    ["userinfo on our host", "https://user:pw@gallery.381studios.ar/acme"],
    ["port", "https://gallery.381studios.ar:8443/acme"],
    ["http scheme", "http://gallery.381studios.ar/acme"],
    ["other scheme", "javascript://gallery.381studios.ar/acme"],
    ["trailing slash", `${ORIGIN}/acme/`],
    ["double slash", `${ORIGIN}//acme`],
    ["encoded slash", `${ORIGIN}/acme%2F`],
    ["encoded letter", `${ORIGIN}/%61cme`],
    ["dot suffix", `${ORIGIN}/acme.`],
    ["semicolon", `${ORIGIN}/acme;x`],
    ["root", `${ORIGIN}/`],
    ["extra segment", `${ORIGIN}/acme/extra`],
    ["the album itself", `${ORIGIN}/acme/pub`],
    ["another album of the client", `${ORIGIN}/acme/other`],
    ["another client", `${ORIGIN}/beta`],
    ["another client's album", `${ORIGIN}/beta/bpub`],
    ["admin", `${ORIGIN}/admin`],
    ["bare album slug", `${ORIGIN}/pub`],
    ["unknown client", `${ORIGIN}/nope`],
  ])("%s", async (_n, referer) => {
    const d = await acme(referer);
    expect(d.state).toBe("open");
    expect(d).not.toHaveProperty("backToClient");
    expect(JSON.stringify(d)).not.toContain("ACME Corp");
  });

  it("a direct open never carries the client's name or page data (only the slug the URL has)", async () => {
    const s = JSON.stringify(await acme());
    expect(s).not.toContain("ACME Corp");
    expect(s).not.toContain("backToClient");
    expect(s).not.toContain("pagina");
  });

  it("the client's page is disabled: no link", async () => {
    const d = await load("off", "offpub", `${ORIGIN}/off`);
    expect(d.state).toBe("open");
    expect(d).not.toHaveProperty("backToClient");
  });

  it("an album without a client: a Referer from a client page gives nothing", async () => {
    const d = await load(undefined, "free", `${ORIGIN}/acme`);
    expect(d.state).toBe("open");
    expect(d).not.toHaveProperty("backToClient");
  });

  it("a client's album with another client's page as Referer: none (cross-client forgery)", async () => {
    const d = await load("beta", "bpub", `${ORIGIN}/acme`);
    expect(d).not.toHaveProperty("backToClient");
  });

  it("an unavailable album stays the plain 404 payload even with a perfect Referer", async () => {
    const d = await load("acme", "dra", `${ORIGIN}/acme`);
    expect(d).toEqual({ state: "unavailable", origin: ORIGIN });
  });
});

describe("T6.50 cost", () => {
  async function count(referer?: string) {
    const c = countingEnv(e);
    await load("acme", "pub", referer, {}, c.e);
    return c.count();
  }
  it("the Referer check adds no D1 query (the client row comes with the album lookup)", async () => {
    const without = await count();
    const withRef = await count(`${ORIGIN}/acme?pagina=2`);
    const forged = await count("https://evil.com/acme");
    expect(withRef).toBe(without);
    expect(forged).toBe(without);
    expect(without).toBeLessThanOrEqual(SLUG_LOADER_D1_QUERIES);
  });
});

describe("T6.50 only an album the client page lists can name its client", () => {
  const fix = async (
    slug: string,
    over: Partial<typeof schema.galleries.$inferInsert>,
    photos = 0,
  ) => {
    await db.insert(schema.galleries).values({
      id: `g-${slug}`,
      driveFolderId: `d-${slug}`,
      slug,
      title: slug,
      status: "published",
      clientId: "c-acme",
      ...over,
    });
    if (photos) await seedPhotos(`g-${slug}`, photos);
  };
  const REF = `${ORIGIN}/acme`;

  it("open album without a cover or PIN (client page would 404): no name, document and .data", async () => {
    await fix("nocover", {});
    for (const mode of ["navigate", "cors"]) {
      const d = await load("acme", "nocover", REF, { "Sec-Fetch-Mode": mode });
      expect(d.state).toBe("open");
      expect(d).not.toHaveProperty("backToClient");
      expect(JSON.stringify(d)).not.toContain("ACME Corp");
    }
  });

  it("expired album is unavailable (plain 404 payload, no name)", async () => {
    await fix("old", { expiresAt: "2000-01-01T00:00:00Z" }, 1);
    const d = await load("acme", "old", REF);
    expect(JSON.stringify(d)).not.toContain("ACME Corp");
    expect(d).not.toHaveProperty("backToClient");
  });

  it("draft: no name", async () => {
    await fix("dr", { status: "draft" }, 1);
    expect(JSON.stringify(await load("acme", "dr", REF))).not.toContain("ACME");
  });

  it("PIN album with no cover is listed (locked tile): link carried", async () => {
    const d = await load("acme", "pin", REF);
    expect(d.backToClient).toEqual({ name: "ACME Corp", href: "/acme" });
  });

  it("proofing album whose photos have no preview-wm has no cover: no name", async () => {
    await fix("proof", { mode: "proofing" });
    await seedPhotos("g-proof", 1, false);
    const d = await load("acme", "proof", REF);
    expect(d).not.toHaveProperty("backToClient");
  });

  it("the unlisted album costs no extra D1 query", async () => {
    await fix("nocover", {});
    const c = countingEnv(e);
    await load("acme", "nocover", REF, {}, c.e);
    expect(c.count()).toBeLessThanOrEqual(SLUG_LOADER_D1_QUERIES);
  });
});

describe("T6.50 locked path", () => {
  it("a direct or forged-Referer open of a PIN album has no name and no key", async () => {
    for (const ref of [undefined, "https://evil.com/acme", `${ORIGIN}/beta`]) {
      const d = await load("acme", "pin", ref);
      expect(d.state).toBe("locked");
      const s = JSON.stringify(d);
      expect(s).not.toContain("ACME Corp");
      expect(s).not.toContain("backToClient");
    }
  });

  it("with the client page as Referer the name travels in the payload only (PinScreen never renders it)", async () => {
    const d = await load("acme", "pin", `${ORIGIN}/acme`);
    expect(d.backToClient).toEqual({ name: "ACME Corp", href: "/acme" });
  });
});
