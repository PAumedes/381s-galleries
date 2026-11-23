import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_LANG_COOKIE } from "../app/i18n/lang";
import { migrateDb, resetTables } from "./support/d1";
import {
  galleryAction,
  loadGalleryEdit,
} from "../app/lib/server/admin-galleries";
import { createClient } from "../app/lib/server/clients";
import { meterD1 } from "../app/lib/server/d1-meter";
import {
  D1_FREE_QUERIES_PER_INVOCATION,
  INVOCATION_SAFETY,
} from "../app/lib/server/d1-limits";
import { loadHome } from "../app/lib/server/home";
import { adminIndexData } from "../app/routes/admin._index";
import { cardData } from "../app/routes/admin.g.$id.card";
import { editData } from "../app/routes/admin.g.$id";

import { CLIENT_CHOICES_MAX } from "../app/lib/server/admin-galleries/client-choices";
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const BASE = "http://localhost";

beforeAll(migrateDb);
beforeEach(() => resetTables("photos", "galleries", "clients"));

const run = (s: string, ...b: unknown[]) =>
  env.DB.prepare(s)
    .bind(...b)
    .run();
const addGallery = (id: string, slug: string, extra = "") =>
  run(
    `INSERT INTO galleries (id, drive_folder_id, slug, title, status${extra ? ", " + extra.split("|")[0] : ""}) VALUES (?1, ?2, ?3, 'T ' || ?3, 'published'${extra ? ", " + extra.split("|")[1] : ""})`,
    id,
    `drive-secret-${id}`,
    slug,
  );
const addPhoto = (id: string, g: string, wm: string | null) =>
  run(
    "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id, drive_wm_id) VALUES (?1, ?2, ?1, 'hr-' || ?1, ?3)",
    id,
    g,
    wm,
  );
const row = (id: string) =>
  env.DB.prepare(
    "SELECT client_id, mode, show_on_home, slug, title, status FROM galleries WHERE id = ?1",
  )
    .bind(id)
    .first<{
      client_id: string | null;
      mode: string;
      show_on_home: number;
      slug: string;
      title: string;
      status: string;
    }>();

function details(id: string, over: Record<string, string> = {}, lang = "es") {
  const body = new URLSearchParams({
    intent: "details",
    title: "Nuevo",
    slug: "",
    eventDate: "",
    expiresDate: "",
    expiresTime: "",
    ...over,
  });
  return galleryAction(
    new Request(`${BASE}/admin/g/${id}?lang=${lang}`, {
      method: "POST",
      headers: { cookie: `${ADMIN_LANG_COOKIE}=${lang}` },
      body,
    }),
    e,
    id,
  );
}
/** Details form of an album as the page renders it (slug kept). */
const save = async (
  id: string,
  over: Record<string, string> = {},
  lang = "es",
) => {
  const r = await row(id);
  return details(id, { slug: r!.slug, title: r!.title, ...over }, lang);
};

describe("T6.40c assign an album to a client (details save)", () => {
  it("assigns, keeps the slug, and a missing clientId field leaves the client alone", async () => {
    const c = await createClient(e, { name: "Acme" });
    await addGallery("g1", "boda");
    const r = await save("g1", { clientId: c.id });
    expect(r.ok).toBe(true);
    expect(await row("g1")).toMatchObject({ client_id: c.id, slug: "boda" });
    expect((await save("g1")).ok).toBe(true);
    expect((await row("g1"))!.client_id).toBe(c.id);
  });

  it("rejects an unknown client id and saves nothing (not even the title)", async () => {
    await addGallery("g1", "boda");
    const r = await save("g1", { clientId: "nope", title: "Cambiado" });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.clientId).toBeTruthy();
    expect(await row("g1")).toMatchObject({
      client_id: null,
      title: "T boda",
    });
  });

  it("first assignment copies mode and show_on_home and the message names them (ES/EN)", async () => {
    const c = await createClient(e, {
      name: "Acme",
      defaultMode: "proofing",
      defaultShowOnHome: true,
    });
    await addGallery("g1", "boda");
    await addGallery("g2", "fiesta");
    const es = await save("g1", { clientId: c.id }, "es");
    expect(await row("g1")).toMatchObject({
      mode: "proofing",
      show_on_home: 1,
    });
    expect(es.message).toContain("Acme");
    expect(es.message).toMatch(/modo/i);
    expect(es.message).toMatch(/inicio/i);
    const en = await save("g2", { clientId: c.id }, "en");
    expect(en.message).toContain("Acme");
    expect(en.message).toMatch(/mode/i);
    expect(en.message).toMatch(/home/i);
  });

  it("does not list a field that already had the client's value", async () => {
    const c = await createClient(e, { name: "Acme", defaultMode: "delivery" });
    await addGallery("g1", "boda");
    const r = await save("g1", { clientId: c.id }, "en");
    expect(r.message).not.toMatch(/mode/i);
  });

  it("show_on_home copies only for a published, PIN-less, unexpired album", async () => {
    const c = await createClient(e, { name: "Acme", defaultShowOnHome: true });
    await addGallery("draft", "d1");
    await run("UPDATE galleries SET status = 'draft' WHERE id = 'draft'");
    await addGallery("pin", "p1");
    await run("UPDATE galleries SET pin_hash = 'x' WHERE id = 'pin'");
    await addGallery("exp", "e1");
    await addGallery("ok", "o1");
    for (const id of ["draft", "pin", "ok"]) await save(id, { clientId: c.id });
    await save("exp", {
      clientId: c.id,
      expiresDate: "2001-01-01",
      expiresTime: "10:00",
    });
    expect((await row("draft"))!.show_on_home).toBe(0);
    expect((await row("pin"))!.show_on_home).toBe(0);
    expect((await row("exp"))!.show_on_home).toBe(0);
    expect((await row("ok"))!.show_on_home).toBe(1);
  });

  it("copies defaults exactly once: later saves, other clients and 'none' keep the album's own settings", async () => {
    const a = await createClient(e, {
      name: "Acme",
      defaultMode: "proofing",
      defaultShowOnHome: true,
    });
    const b = await createClient(e, {
      name: "Beta",
      defaultMode: "delivery",
      defaultShowOnHome: false,
    });
    await addGallery("g1", "boda");
    await save("g1", { clientId: a.id });
    await run(
      "UPDATE galleries SET mode = 'delivery', show_on_home = 0 WHERE id = 'g1'",
    );
    await save("g1", { clientId: a.id }); // same client again
    expect(await row("g1")).toMatchObject({
      mode: "delivery",
      show_on_home: 0,
    });
    await run(
      "UPDATE galleries SET mode = 'proofing', show_on_home = 1 WHERE id = 'g1'",
    );
    const mv = await save("g1", { clientId: b.id }); // move between clients
    expect(await row("g1")).toMatchObject({
      client_id: b.id,
      mode: "proofing",
      show_on_home: 1,
    });
    expect(mv.message).not.toMatch(/modo/i);
    const un = await save("g1", { clientId: "" }); // unassign
    expect(un.ok).toBe(true);
    expect(await row("g1")).toMatchObject({
      client_id: null,
      mode: "proofing",
      show_on_home: 1,
    });
  });

  it("Prueba default warns about photos without preview-wm but never blocks", async () => {
    const c = await createClient(e, { name: "Acme", defaultMode: "proofing" });
    await addGallery("g1", "boda");
    await addPhoto("p1", "g1", "wm1");
    await addPhoto("p2", "g1", null);
    await addPhoto("p3", "g1", "");
    const r = await save("g1", { clientId: c.id }, "en");
    expect(r.ok).toBe(true);
    expect((await row("g1"))!.mode).toBe("proofing");
    expect(r.message).toMatch(/2 photos?.*preview/i);
    // no warning when every photo has one
    await addGallery("g2", "fiesta");
    await addPhoto("p4", "g2", "wm4");
    expect((await save("g2", { clientId: c.id }, "en")).message).not.toMatch(
      /preview/i,
    );
  });

  it("a client deleted before the save leaves the album unassigned, not an FK error", async () => {
    const c = await createClient(e, { name: "Acme" });
    await addGallery("g1", "boda");
    await run("DELETE FROM clients WHERE id = ?1", c.id);
    const r = await save("g1", { clientId: c.id });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.clientId).toBeTruthy();
  });
});

describe("T6.40c loaders and canonical URLs", () => {
  it("edit loader: clientId, clientSlug, client choices (<=cap, assigned always included), no drive ids, +1 query", async () => {
    const c = await createClient(e, { name: "Zeta" });
    for (let i = 0; i < CLIENT_CHOICES_MAX + 1; i++)
      await run(
        "INSERT INTO clients (id, slug, name) VALUES (?1, ?1, ?2)",
        `c${String(i).padStart(3, "0")}`,
        `A ${String(i).padStart(3, "0")}`,
      );
    await addGallery("g1", "boda");
    await save("g1", { clientId: c.id });
    const m = meterD1(e);
    const d = await loadGalleryEdit(m.env, "g1");
    expect(d!.gallery.clientId).toBe(c.id);
    expect(d!.gallery.clientSlug).toBe(c.slug);
    expect(d!.clients.length).toBe(CLIENT_CHOICES_MAX);
    expect(d!.clients.some((x) => x.id === c.id)).toBe(true);
    const names = d!.clients.map((x) => x.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(JSON.stringify(d)).not.toContain("drive-secret");
    // 3 queries before T6.40c (gallery, photos, deleting check) + the client choices.
    expect(m.used()).toBe(4);
    const full = await editData(new Request(`${BASE}/admin/g/g1`), e, "g1");
    expect(full.origin).toBeTruthy();
  });

  it("card url and home item use /<client>/<album> for assigned albums only", async () => {
    const c = await createClient(e, { name: "Acme", slug: "acme" });
    await addGallery("g1", "boda");
    await addGallery("g2", "fiesta");
    await save("g1", { clientId: c.id });
    const req = (id: string) => new Request(`${BASE}/admin/g/${id}/card`);
    expect((await cardData(req("g1"), e, "g1")).url).toBe(
      "https://gallery.381studios.ar/acme/boda",
    );
    expect((await cardData(req("g2"), e, "g2")).url).toBe(
      "https://gallery.381studios.ar/fiesta",
    );
    for (const id of ["g1", "g2"]) {
      await addPhoto(`ph-${id}`, id, "wm");
      await run("UPDATE galleries SET show_on_home = 1 WHERE id = ?1", id);
    }
    const items = (await loadHome(e)).items;
    expect(items.find((i) => i.slug === "boda")!.clientSlug).toBe("acme");
    expect(items.find((i) => i.slug === "fiesta")!.clientSlug).toBeUndefined();
  });

  it("list: client column, filter none / one client / unknown, combined with status and search; clients for the select", async () => {
    const a = await createClient(e, { name: "Acme", slug: "acme" });
    const b = await createClient(e, { name: "Beta", slug: "beta" });
    await addGallery("g1", "boda");
    await addGallery("g2", "fiesta");
    await addGallery("g3", "cumple");
    await run("UPDATE galleries SET status = 'draft' WHERE id = 'g3'");
    await save("g1", { clientId: a.id });
    await save("g3", { clientId: a.id });
    await save("g2", { clientId: b.id });
    const list = async (qs: string) => {
      const m = meterD1(e);
      const d = await adminIndexData(new Request(`${BASE}/admin?${qs}`), m.env);
      return { d, n: m.used() };
    };
    const all = await list("");
    expect(all.d.clients.map((c) => c.name)).toEqual(["Acme", "Beta"]);
    const g1 = all.d.galleries.find((g) => g.id === "g1")!;
    expect(g1.client).toEqual({ id: a.id, name: "Acme", slug: "acme" });
    const base = (await list("estado=publicadas")).n;
    // 4 before T6.40c (google, list, count, setting) + the client choices; a filter adds none.
    expect(all.n).toBe(5);
    expect(base).toBe(5);
    expect(all.n).toBeLessThan(
      D1_FREE_QUERIES_PER_INVOCATION - INVOCATION_SAFETY,
    );
    const ids = async (qs: string) =>
      (await list(qs)).d.galleries.map((g) => g.id).sort();
    expect(await ids(`cliente=${a.id}`)).toEqual(["g1", "g3"]);
    expect(await ids(`cliente=${a.id}&estado=publicadas`)).toEqual(["g1"]);
    expect(await ids(`cliente=${b.id}&q=fiesta`)).toEqual(["g2"]);
    expect(await ids(`cliente=${b.id}&q=boda`)).toEqual([]);
    await addGallery("g4", "solo");
    expect(await ids("cliente=none")).toEqual(["g4"]);
    expect(await ids("cliente=zzz")).toEqual([]);
    expect((await list(`cliente=${a.id}`)).d.clientFilter).toBe(a.id);
    expect((await list("cliente=none")).d.clientFilter).toBe("none");
    expect((await list("")).d.clientFilter).toBe("");
  });
});
