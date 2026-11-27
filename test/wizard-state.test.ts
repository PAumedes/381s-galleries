import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../app/lib/server/clients";
import { meterD1 } from "../app/lib/server/d1-meter";
import {
  WIZARD_BANNER_D1_QUERIES,
  WIZARD_D1_QUERIES,
  wizardAction,
  loadWizard,
  wizardBannerVisible,
  wizardData,
} from "../app/lib/server/admin-wizard";
import { putSetting, SETTINGS_KEYS } from "../app/lib/server/settings";
import { adminIndexData } from "../app/routes/admin._index";
import { migrateDb, resetTables } from "./support/d1";

// T6.58: the first-run wizard. Each step's state comes from the real data.

const live = { ...env, DRIVE_MODE: "live", ALLOW_DEV_ADMIN: "1" } as Env;
const mock = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const BASE = "http://localhost";
const get = (path = "/admin/empezar") => new Request(`${BASE}${path}`);

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("photos", "galleries", "clients", "settings");
});

const run = (s: string, ...b: unknown[]) =>
  env.DB.prepare(s)
    .bind(...b)
    .run();
const addGallery = (
  id: string,
  slug: string,
  status = "draft",
  extra: Record<string, string | number | null> = {},
) => {
  const cols = ["id", "drive_folder_id", "slug", "title", "status"];
  const vals: unknown[] = [
    id,
    `drive-secret-${id}`,
    slug,
    `Title ${slug}`,
    status,
  ];
  for (const [k, v] of Object.entries(extra)) {
    cols.push(k);
    vals.push(v);
  }
  return run(
    `INSERT INTO galleries (${cols.join(",")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(",")})`,
    ...vals,
  );
};
const connect = async () => {
  await putSetting(live, SETTINGS_KEYS.googleRefreshToken, "secret-refresh");
  await putSetting(live, SETTINGS_KEYS.driveRootName, "Sesiones");
};

describe("T6.58 wizard data: access", () => {
  it("401 for a non-admin", async () => {
    const r = await wizardData(get(), {
      ...mock,
      ALLOW_DEV_ADMIN: "0",
    } as Env).catch((x) => x as Response);
    expect((r as Response).status).toBe(401);
  });
});

describe("T6.58 wizard data: the state of each step", () => {
  it("empty studio: drive todo, folders read, client optional, gallery todo, settings todo, share read", async () => {
    const d = await loadWizard(get(), live);
    expect(d.states).toEqual([
      "todo",
      "read",
      "optional",
      "todo",
      "todo",
      "read",
    ]);
    expect(d.step).toBe(1);
    expect(d.target).toBeNull();
    expect(d.galleries.count).toBe(0);
  });

  it("drive is done only with a connection AND a chosen folder", async () => {
    await putSetting(live, SETTINGS_KEYS.googleRefreshToken, "x");
    expect((await loadWizard(get(), live)).states[0]).toBe("todo");
    await putSetting(live, SETTINGS_KEYS.driveRootName, "Sesiones");
    const d = await loadWizard(get(), live);
    expect(d.states[0]).toBe("done");
    expect(d.rootName).toBe("Sesiones");
    expect(d.step).toBe(4);
  });

  it("demo mode counts as connected", async () => {
    const d = await loadWizard(get(), mock);
    expect(d.states[0]).toBe("done");
    expect(d.mock).toBe(true);
  });

  it("a client makes step 3 done", async () => {
    await createClient(live, { name: "Ana" });
    const d = await loadWizard(get(), live);
    expect(d.states[2]).toBe("done");
  });

  it("a draft gallery makes step 4 done but not the settings", async () => {
    await connect();
    await addGallery("g1", "boda");
    const d = await loadWizard(get(), live);
    expect(d.states).toEqual([
      "done",
      "read",
      "optional",
      "done",
      "todo",
      "read",
    ]);
    expect(d.step).toBe(5);
    expect(d.galleries).toMatchObject({ count: 1, published: 0 });
    expect(d.target?.id).toBe("g1");
  });

  it("a published gallery makes step 5 done; with everything done the default is the last step", async () => {
    await connect();
    await createClient(live, { name: "Ana" });
    await addGallery("g1", "boda", "published");
    const d = await loadWizard(get(), live);
    expect(d.states).toEqual(["done", "read", "done", "done", "done", "read"]);
    expect(d.step).toBe(6);
  });

  it("archived galleries do not count and are never the target", async () => {
    await connect();
    await addGallery("old", "viejo", "archived");
    const d = await loadWizard(get(), live);
    expect(d.galleries.count).toBe(0);
    expect(d.target).toBeNull();
    expect(d.states[3]).toBe("todo");
  });
});

describe("T6.58 wizard data: the target is the published gallery when there is one", () => {
  const stamp = (id: string, at: string) =>
    run("UPDATE galleries SET created_at = ?2 WHERE id = ?1", id, at);

  it("a newer draft does not hide an older published gallery (steps 5 and 6 describe the same one)", async () => {
    await connect();
    await addGallery("old", "publicada", "published");
    await addGallery("new", "borrador", "draft");
    await stamp("old", "2024-01-01T00:00:00.000Z");
    await stamp("new", "2025-01-01T00:00:00.000Z");
    const d = await loadWizard(get("/admin/empezar?paso=6"), live);
    expect(d.states[4]).toBe("done");
    expect(d.target).toMatchObject({ id: "old", status: "published" });
    expect(d.target?.url).toContain("/publicada");
  });

  it("the newest published wins among several", async () => {
    await addGallery("a", "a", "published");
    await addGallery("b", "b", "published");
    await stamp("a", "2024-01-01T00:00:00.000Z");
    await stamp("b", "2025-01-01T00:00:00.000Z");
    expect((await loadWizard(get(), live)).target?.id).toBe("b");
  });

  it("only drafts: the newest draft", async () => {
    await addGallery("a", "a");
    await addGallery("b", "b");
    await stamp("a", "2024-01-01T00:00:00.000Z");
    await stamp("b", "2025-01-01T00:00:00.000Z");
    const d = await loadWizard(get(), live);
    expect(d.target).toMatchObject({ id: "b", status: "draft" });
    expect(d.states[4]).toBe("todo");
  });

  it("an archived gallery is never the target until it is restored", async () => {
    await addGallery("a", "a", "archived");
    expect((await loadWizard(get(), live)).target).toBeNull();
    await run("UPDATE galleries SET status = 'draft' WHERE id = 'a'");
    expect((await loadWizard(get(), live)).target?.id).toBe("a");
  });

  it("tells whether the gallery or its client has a PIN, never the hash", async () => {
    const c = await createClient(live, { name: "Ana", slug: "ana" });
    await addGallery("g1", "boda", "published", { client_id: c.id });
    expect((await loadWizard(get(), live)).target).toMatchObject({
      pin: false,
      clientPin: false,
    });
    await run("UPDATE clients SET pin_hash = 'pbkdf2$client-secret'");
    const d = await loadWizard(get(), live);
    expect(d.target?.clientPin).toBe(true);
    expect(JSON.stringify(d)).not.toContain("client-secret");
  });
});

describe("T6.58 wizard data: done is not always true", () => {
  it("each step flips with its own fact, and only with it", async () => {
    const at = async () => (await loadWizard(get(), live)).states;
    expect(await at()).toEqual([
      "todo",
      "read",
      "optional",
      "todo",
      "todo",
      "read",
    ]);
    await connect();
    expect((await at())[0]).toBe("done");
    expect((await at()).slice(1)).toEqual([
      "read",
      "optional",
      "todo",
      "todo",
      "read",
    ]);
    await createClient(live, { name: "Ana" });
    expect((await at())[2]).toBe("done");
    expect((await at())[3]).toBe("todo");
    await addGallery("g1", "boda");
    expect((await at())[3]).toBe("done");
    expect((await at())[4]).toBe("todo");
    await run("UPDATE galleries SET status = 'published'");
    expect((await at())[4]).toBe("done");
  });
});

describe("T6.58 wizard data: which step is shown", () => {
  it("?paso=N picks the step; bad values fall back to the first open step", async () => {
    expect((await loadWizard(get("/admin/empezar?paso=3"), live)).step).toBe(3);
    expect((await loadWizard(get("/admin/empezar?paso=6"), live)).step).toBe(6);
    for (const bad of [
      "0",
      "7",
      "-1",
      "abc",
      "",
      "1.5",
      "01",
      "2&paso=3",
      "1e1",
    ])
      expect(
        (await loadWizard(get(`/admin/empezar?paso=${bad}`), live)).step,
        bad,
      ).toBe(bad === "2&paso=3" ? 2 : 1);
  });
});

describe("T6.58 wizard data: the gallery the last steps talk about", () => {
  it("is the newest not-archived gallery, with the real settings and link", async () => {
    await connect();
    const c = await createClient(live, { name: "Ana", slug: "ana" });
    await addGallery("g0", "viejo", "published");
    await run(
      "UPDATE galleries SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = 'g0'",
    );
    await addGallery("g1", "boda", "published", {
      client_id: c.id,
      mode: "proofing",
      pin_hash: "pbkdf2$secret",
      allow_highres: 0,
      allow_web: 0,
      allow_ig: 0,
      allow_bulk: 0,
      expires_at: "2030-01-01T12:00:00.000Z",
    });
    const t = (await loadWizard(get(), live)).target!;
    expect(t).toMatchObject({
      id: "g1",
      title: "Title boda",
      status: "published",
      mode: "proofing",
      pin: true,
      downloads: false,
      expiresAt: "2030-01-01T12:00:00.000Z",
      url: "https://gallery.381studios.ar/ana/boda",
      clientName: "Ana",
      clientUrl: "https://gallery.381studios.ar/ana",
    });
  });

  it("without a client, or with the client page off, there is no client link", async () => {
    await addGallery("g1", "boda");
    expect((await loadWizard(get(), live)).target).toMatchObject({
      url: "https://gallery.381studios.ar/boda",
      clientUrl: null,
      clientName: null,
      pin: false,
      downloads: true,
      expiresAt: null,
    });
    const c = await createClient(live, { name: "Ana", slug: "ana" });
    await run("UPDATE clients SET page_enabled = 0 WHERE id = ?1", c.id);
    await run("UPDATE galleries SET client_id = ?1", c.id);
    expect((await loadWizard(get(), live)).target?.clientUrl).toBeNull();
  });

  it("lists up to 5 detected galleries by name, with ids only for admin links", async () => {
    for (let i = 0; i < 7; i++) await addGallery(`g${i}`, `s${i}`);
    const d = await loadWizard(get(), live);
    expect(d.galleries.count).toBe(7);
    expect(d.galleries.recent).toHaveLength(5);
    expect(Object.keys(d.galleries.recent[0]!).sort()).toEqual([
      "id",
      "status",
      "title",
    ]);
  });

  it("never sends Drive ids, tokens or PIN hashes", async () => {
    await connect();
    await addGallery("g1", "boda", "published", { pin_hash: "pbkdf2$secret" });
    const json = JSON.stringify(await loadWizard(get(), live));
    for (const s of ["drive-secret", "secret-refresh", "pbkdf2", "refresh"])
      expect(json).not.toContain(s);
  });

  it("stays within its query budget", async () => {
    await connect();
    await createClient(live, { name: "Ana" });
    await addGallery("g1", "boda", "published");
    const m = meterD1(live);
    await loadWizard(get(), m.env);
    expect(m.used()).toBeLessThanOrEqual(WIZARD_D1_QUERIES);
    expect(WIZARD_D1_QUERIES).toBeLessThanOrEqual(6);
  });
});

const post = (
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) =>
  new Request(`${BASE}/admin/empezar`, {
    method: "POST",
    headers: { Origin: BASE, ...headers },
    body: new URLSearchParams(fields),
  });
const redirectOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (x) {
    if (x instanceof Response) return x;
    throw x;
  }
  return null;
};

describe("T6.58 wizard actions", () => {
  it("createClient creates the client and returns to step 4", async () => {
    const r = await redirectOf(
      wizardAction(post({ intent: "createClient", name: "Ana López" }), mock),
    );
    expect(r?.status).toBe(303);
    expect(r?.headers.get("Location")).toBe("/admin/empezar?paso=4");
    const row = await env.DB.prepare("SELECT name, slug FROM clients").first<{
      name: string;
      slug: string;
    }>();
    expect(row).toEqual({ name: "Ana López", slug: "ana-lopez" });
  });

  it("an empty name is a field error and nothing is created", async () => {
    const out = await wizardAction(
      post({ intent: "createClient", name: "  " }),
      mock,
    );
    expect(out).toMatchObject({ intent: "createClient", ok: false });
    expect(
      (out as { fieldErrors?: Record<string, string> }).fieldErrors?.name,
    ).toBeTruthy();
    expect(
      (await env.DB.prepare("SELECT count(*) n FROM clients").first<{
        n: number;
      }>())!.n,
    ).toBe(0);
  });

  it("dismiss saves the choice and goes to the admin home", async () => {
    const r = await redirectOf(wizardAction(post({ intent: "dismiss" }), mock));
    expect(r?.headers.get("Location")).toBe("/admin");
    const row = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'wizard_dismissed'",
    ).first<{ value: string }>();
    expect(row?.value).toBe("1");
  });

  it("unknown intent fails; cross-site is 403; non-admin is 401", async () => {
    expect(await wizardAction(post({ intent: "nope" }), mock)).toMatchObject({
      ok: false,
    });
    const x = await wizardAction(
      post({ intent: "dismiss" }, { Origin: "https://evil.test" }),
      mock,
    ).catch((e) => e as Response);
    expect((x as Response).status).toBe(403);
    const n = await wizardAction(post({ intent: "dismiss" }), {
      ...mock,
      ALLOW_DEV_ADMIN: "0",
    } as Env).catch((e) => e as Response);
    expect((n as Response).status).toBe(401);
  });
});

describe("T6.58 banner on the admin home", () => {
  const home = (e: Env) => adminIndexData(get("/admin"), e);
  const visible = (e: Env, connected: boolean, galleries: number) =>
    wizardBannerVisible(e, { connected, galleries });

  it("shows when there is no gallery yet (demo mode counts as connected)", async () => {
    expect((await home(mock)).wizard).toBe(true);
  });

  it("an archived-only studio sees the same story as step 4: banner on, wizard says no gallery", async () => {
    await addGallery("a", "a", "archived");
    expect((await home(mock)).wizard).toBe(true);
    expect((await loadWizard(get(), mock)).galleries.count).toBe(0);
  });

  it("is hidden once there is a gallery and Drive works", async () => {
    await addGallery("g1", "boda");
    expect((await home(mock)).wizard).toBe(false);
  });

  it("rule: shows with no gallery or with Drive not connected, hides when both are fine", async () => {
    expect(await visible(live, true, 0)).toBe(true);
    expect(await visible(live, false, 3)).toBe(true);
    expect(await visible(live, false, 0)).toBe(true);
    expect(await visible(live, true, 3)).toBe(false);
  });

  it("stays hidden after the owner dismissed it", async () => {
    await redirectOf(wizardAction(post({ intent: "dismiss" }), mock));
    expect((await home(mock)).wizard).toBe(false);
    expect(await visible(live, false, 0)).toBe(false);
  });

  it("costs at most WIZARD_BANNER_D1_QUERIES more queries, and none when it is not shown", async () => {
    await addGallery("g1", "boda");
    const quiet = meterD1(mock);
    expect((await home(quiet.env)).wizard).toBe(false);
    await resetTables("photos", "galleries");
    await addGallery("g2", "otra");
    const connected = meterD1(mock);
    await home(connected.env);
    expect(connected.used()).toBe(quiet.used());
    // The banner shows: one more query, the dismissal.
    await resetTables("photos", "galleries");
    const shown = meterD1(mock);
    expect((await home(shown.env)).wizard).toBe(true);
    expect(shown.used() - quiet.used()).toBeLessThanOrEqual(
      WIZARD_BANNER_D1_QUERIES,
    );
    expect(WIZARD_BANNER_D1_QUERIES).toBe(1);
  });
});
