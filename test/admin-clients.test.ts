import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateDb, resetTables } from "./support/d1";
import {
  clientAction,
  clientEditData,
  clientsListData,
  createClientAction,
} from "../app/lib/server/admin-clients";
import { createClient, getClient } from "../app/lib/server/clients";
import routes from "../app/routes";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const nonAdmin = { ...e, ALLOW_DEV_ADMIN: "0" } as Env;

beforeAll(migrateDb);
beforeEach(() => resetTables("photos", "galleries", "clients"));

const run = (s: string, ...b: unknown[]) =>
  env.DB.prepare(s)
    .bind(...b)
    .run();
/** `extra`: more columns, as SQL literals (e.g. { status: "'published'" }). */
const addGallery = (
  id: string,
  slug: string,
  clientId: string | null = null,
  extra: Record<string, string> = {},
) =>
  run(
    `INSERT INTO galleries (id, drive_folder_id, slug, title, client_id${Object.keys(
      extra,
    )
      .map((k) => ", " + k)
      .join("")}) VALUES (?1, ?2, ?3, 'T ' || ?3, ?4${Object.values(extra)
      .map((v) => ", " + v)
      .join("")})`,
    id,
    `drive-secret-${id}`,
    slug,
    clientId,
  );
const addPhoto = (id: string, galleryId: string, wm: string | null) =>
  run(
    "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id, drive_wm_id) VALUES (?1, ?2, ?1, 'hr-' || ?1, ?3)",
    id,
    galleryId,
    wm,
  );
const galleryRow = (id: string) =>
  env.DB.prepare(
    "SELECT client_id, mode, show_on_home, slug FROM galleries WHERE id = ?1",
  )
    .bind(id)
    .first<{
      client_id: string | null;
      mode: string;
      show_on_home: number;
      slug: string;
    }>();

const BASE = "http://localhost";
const post = (
  path: string,
  fields: Record<string, string>,
  headers: HeadersInit = {},
) =>
  new Request(BASE + path, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  });
const create = (fields: Record<string, string>, headers: HeadersInit = {}) =>
  createClientAction(post("/admin/clients", fields, headers), e);
const act = (id: string, fields: Record<string, string>, h: HeadersInit = {}) =>
  clientAction(post(`/admin/clients/${id}`, fields, h), e, id);
const thrown = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (x) {
    return x as Response;
  }
  throw new Error("expected a thrown Response");
};

describe("T6.40b admin clients: loaders", () => {
  it("list: 401 for non-admins", async () => {
    const res = await thrown(
      clientsListData(new Request(BASE + "/admin/clients"), nonAdmin),
    );
    expect(res.status).toBe(401);
  });

  it("list: only the fields the page needs, album counts, deleted message", async () => {
    const a = await createClient(e, { name: "Zeta" });
    await createClient(e, { name: "Alfa" });
    await addGallery("g1", "uno", a.id);
    const d = await clientsListData(
      new Request(BASE + "/admin/clients?deleted=1"),
      e,
    );
    expect(d.clients.map((c) => c.name)).toEqual(["Alfa", "Zeta"]);
    expect(Object.keys(d.clients[1]!).sort()).toEqual([
      "albumCount",
      "id",
      "name",
      "pageEnabled",
      "slug",
    ]);
    expect(d.clients[1]!.albumCount).toBe(1);
    expect(d.message).toBe(
      "Cliente eliminado. Sus álbumes siguen existiendo sin cliente.",
    );
  });

  it("edit: client fields and its albums only, no Drive ids", async () => {
    const a = await createClient(e, { name: "Acme", defaultMode: "proofing" });
    const b = await createClient(e, { name: "Beta" });
    await addGallery("g1", "uno", a.id);
    await addGallery("g2", "dos", b.id);
    await addGallery("g3", "tres", null);
    const d = await clientEditData(new Request(BASE + "/x"), e, a.id);
    expect(d.client).toEqual({
      id: a.id,
      name: "Acme",
      slug: "acme",
      pageEnabled: true,
      defaultMode: "proofing",
      defaultShowOnHome: false,
    });
    expect(d.albums.map((g) => g.id)).toEqual(["g1"]);
    expect(Object.keys(d.albums[0]!).sort()).toEqual([
      "id",
      "mode",
      "slug",
      "status",
      "title",
    ]);
    expect(JSON.stringify(d)).not.toContain("drive-secret");
  });

  it("edit: 404 for an unknown client, 401 for non-admins", async () => {
    expect(
      (await thrown(clientEditData(new Request(BASE + "/x"), e, "nope")))
        .status,
    ).toBe(404);
    expect(
      (await thrown(clientEditData(new Request(BASE + "/x"), nonAdmin, "nope")))
        .status,
    ).toBe(401);
  });
});

describe("T6.40b admin clients: create", () => {
  it("guards: 401 non-admin, 403 cross-site", async () => {
    const req = post("/admin/clients", { name: "X" });
    expect((await thrown(createClientAction(req, nonAdmin))).status).toBe(401);
    expect(
      (await thrown(create({ name: "X" }, { "Sec-Fetch-Site": "cross-site" })))
        .status,
    ).toBe(403);
  });

  it("auto slug from the name (never colliding with a gallery slug), redirects to the edit page", async () => {
    await addGallery("g1", "coca-cola");
    const res = await thrown(create({ name: "Coca Cola", slug: "" }));
    expect(res.status).toBe(303);
    const loc = res.headers.get("Location")!;
    const id = loc.replace("/admin/clients/", "");
    const c = await getClient(e, id);
    expect(c?.name).toBe("Coca Cola");
    expect(c?.slug).not.toBe("coca-cola");
    expect(c?.slug.startsWith("coca-cola")).toBe(true);
  });

  it("explicit slug is used (lower-cased, trimmed)", async () => {
    const res = await thrown(create({ name: "Acme", slug: " Acme-Co " }));
    const c = await getClient(
      e,
      res.headers.get("Location")!.split("/").pop()!,
    );
    expect(c?.slug).toBe("acme-co");
  });

  it("maps ClientError to localized field messages (es and en)", async () => {
    await addGallery("g1", "ocupado");
    const taken = await create({ name: "X", slug: "ocupado" });
    expect(taken.ok).toBe(false);
    expect(taken.fieldErrors?.slug).toMatch(/ya está en uso/);
    const bad = await create({ name: "X", slug: "Mala Dirección!" });
    expect(bad.fieldErrors?.slug).toMatch(/minúsculas/);
    const reserved = await create({ name: "X", slug: "admin" });
    expect(reserved.fieldErrors?.slug).toBeTruthy();
    const noName = await create({ name: "   ", slug: "" });
    expect(noName.fieldErrors?.name).toMatch(/nombre/i);
    const en = await create(
      { name: "X", slug: "ocupado" },
      { Cookie: "admin_lang=en" },
    );
    expect(en.fieldErrors?.slug).toMatch(/already in use/);
  });
});

describe("T6.40b admin clients: save", () => {
  const form = (over: Record<string, string> = {}) => ({
    intent: "save",
    name: "Acme 2",
    slug: "acme-2",
    pageEnabled: "1",
    defaultMode: "proofing",
    defaultShowOnHome: "1",
    ...over,
  });

  it("saves name, slug, page flag and defaults (unchecked boxes mean false)", async () => {
    const c = await createClient(e, { name: "Acme", defaultShowOnHome: true });
    const r = await act(c.id, form());
    expect(r.ok).toBe(true);
    expect(await getClient(e, c.id)).toMatchObject({
      name: "Acme 2",
      slug: "acme-2",
      pageEnabled: true,
      defaultMode: "proofing",
      defaultShowOnHome: true,
    });
    const r2 = await act(c.id, {
      intent: "save",
      name: "Acme 2",
      slug: "acme-2",
      defaultMode: "delivery",
    });
    expect(r2.ok).toBe(true);
    expect(await getClient(e, c.id)).toMatchObject({
      pageEnabled: false,
      defaultMode: "delivery",
      defaultShowOnHome: false,
    });
  });

  it("slug taken / invalid / name invalid / bad mode are field errors; nothing saved", async () => {
    const c = await createClient(e, { name: "Acme" });
    await createClient(e, { name: "Beta" });
    const taken = await act(c.id, form({ slug: "beta" }));
    expect(taken.fieldErrors?.slug).toMatch(/en uso/);
    expect(
      (await act(c.id, form({ slug: "No Vale" }))).fieldErrors?.slug,
    ).toBeTruthy();
    expect(
      (await act(c.id, form({ name: "" }))).fieldErrors?.name,
    ).toBeTruthy();
    expect(
      (await act(c.id, form({ defaultMode: "hack" }))).fieldErrors?.defaultMode,
    ).toBeTruthy();
    expect((await getClient(e, c.id))?.name).toBe("Acme");
  });

  it("keeping its own slug is not taken; unknown client is 404; guards", async () => {
    const c = await createClient(e, { name: "Acme" });
    expect((await act(c.id, form({ slug: "acme" }))).ok).toBe(true);
    expect((await thrown(act("nope", form()))).status).toBe(404);
    expect(
      (await thrown(act(c.id, form(), { Origin: "https://evil.example" })))
        .status,
    ).toBe(403);
    expect(
      (await thrown(clientAction(post("/x", form()), nonAdmin, c.id))).status,
    ).toBe(401);
  });

  it("unknown intent is a localized error", async () => {
    const c = await createClient(e, { name: "Acme" });
    const r = await act(c.id, { intent: "zzz" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Acción desconocida.");
  });
});

describe("T6.40b admin clients: apply defaults", () => {
  it("needs the confirmation field", async () => {
    const c = await createClient(e, { name: "Acme", defaultMode: "proofing" });
    await addGallery("g1", "uno", c.id);
    const r = await act(c.id, { intent: "applyDefaults" });
    expect(r.ok).toBe(false);
    expect((await galleryRow("g1"))?.mode).toBe("delivery");
  });

  it("sets mode and show_on_home on this client's albums only", async () => {
    const c = await createClient(e, {
      name: "Acme",
      defaultMode: "proofing",
      defaultShowOnHome: true,
    });
    const other = await createClient(e, { name: "Beta" });
    await addGallery("g1", "uno", c.id, { status: "'published'" });
    await addGallery("g2", "dos", c.id, { status: "'draft'" });
    await addGallery("g3", "tres", other.id, { status: "'published'" });
    await addGallery("g4", "cuatro", null, { status: "'published'" });
    const r = await act(c.id, { intent: "applyDefaults", confirm: "1" });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/2 álbumes/);
    expect(await galleryRow("g1")).toMatchObject({
      mode: "proofing",
      show_on_home: 1,
    });
    // Not published: the stored home flag stays honest (off).
    expect(await galleryRow("g2")).toMatchObject({
      mode: "proofing",
      show_on_home: 0,
    });
    for (const id of ["g3", "g4"])
      expect(await galleryRow(id)).toMatchObject({
        mode: "delivery",
        show_on_home: 0,
      });
  });

  it("never turns the home flag on for a PIN-protected or expired album; off defaults turn it off", async () => {
    const c = await createClient(e, { name: "Acme", defaultShowOnHome: true });
    await addGallery("g1", "uno", c.id, {
      status: "'published'",
      pin_hash: "'x'",
    });
    await addGallery("g2", "dos", c.id, {
      status: "'published'",
      expires_at: "'2000-01-01T00:00:00.000Z'",
    });
    await act(c.id, { intent: "applyDefaults", confirm: "1" });
    expect((await galleryRow("g1"))?.show_on_home).toBe(0);
    expect((await galleryRow("g2"))?.show_on_home).toBe(0);
    await run("UPDATE galleries SET show_on_home = 1 WHERE id = 'g1'");
    await run(
      "UPDATE clients SET default_show_on_home = 0 WHERE id = ?1",
      c.id,
    );
    await act(c.id, { intent: "applyDefaults", confirm: "1" });
    expect((await galleryRow("g1"))?.show_on_home).toBe(0);
  });

  it("Prueba warns (does not block) about albums without preview-wm", async () => {
    const c = await createClient(e, { name: "Acme", defaultMode: "proofing" });
    await addGallery("g1", "uno", c.id);
    await addGallery("g2", "dos", c.id);
    await addPhoto("p1", "g1", null);
    await addPhoto("p2", "g2", "wm-file");
    const r = await act(c.id, { intent: "applyDefaults", confirm: "1" });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/2 álbumes/);
    expect(r.message).toMatch(/1 álbum sin preview-wm/);
    expect((await galleryRow("g1"))?.mode).toBe("proofing");
  });

  it("Entrega has no watermark warning; zero albums is a plain message", async () => {
    const c = await createClient(e, { name: "Acme", defaultMode: "delivery" });
    const r0 = await act(c.id, { intent: "applyDefaults", confirm: "1" });
    expect(r0.ok).toBe(true);
    await addGallery("g1", "uno", c.id);
    await addPhoto("p1", "g1", null);
    const r = await act(c.id, { intent: "applyDefaults", confirm: "1" });
    expect(r.message).not.toMatch(/preview-wm/);
  });
});

describe("T6.40b admin clients: delete", () => {
  it("wrong slug: error, nothing deleted", async () => {
    const c = await createClient(e, { name: "Acme" });
    await addGallery("g1", "uno", c.id);
    const r = await act(c.id, { intent: "delete", slug: "otra" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no coincide/);
    expect(await getClient(e, c.id)).not.toBeNull();
    expect((await galleryRow("g1"))?.client_id).toBe(c.id);
  });

  it("typed slug (case-insensitive): client gone, albums kept and unassigned, redirect", async () => {
    const c = await createClient(e, { name: "Acme" });
    const other = await createClient(e, { name: "Beta" });
    await addGallery("g1", "uno", c.id);
    await addGallery("g2", "dos", other.id);
    const res = await thrown(act(c.id, { intent: "delete", slug: " ACME " }));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin/clients?deleted=1");
    expect(await getClient(e, c.id)).toBeNull();
    expect((await galleryRow("g1"))?.client_id).toBeNull();
    expect((await galleryRow("g1"))?.slug).toBe("uno");
    expect((await galleryRow("g2"))?.client_id).toBe(other.id);
  });
});

describe("T6.40b admin clients: routes", () => {
  it("registers admin/clients and admin/clients/:id inside the admin layout", () => {
    const admin = routes.find((r) => "path" in r && r.path === "admin") as {
      children?: { path?: string; file: string }[];
    };
    const paths = admin.children?.map((c) => c.path);
    expect(paths).toContain("clients");
    expect(paths).toContain("clients/:id");
  });
});
