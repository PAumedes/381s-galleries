import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateDb, resetTables } from "../support/d1";
import {
  galleryAction,
  loadGalleryEdit,
} from "../../app/lib/server/admin-galleries";
import { createClient } from "../../app/lib/server/clients";
import { adminIndexData } from "../../app/routes/admin._index";

const e0 = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
beforeAll(migrateDb);
beforeEach(() => resetTables("photos", "galleries", "clients"));

const addGallery = (id: string, slug: string) =>
  env.DB.prepare(
    "INSERT INTO galleries (id, drive_folder_id, slug, title, status) VALUES (?1, ?2, ?3, 'T', 'published')",
  )
    .bind(id, "f" + id, slug)
    .run();

describe("T6.40c adversarial", () => {
  it("client deleted between the existence check and the UPDATE: album must not keep the deleted client's copied defaults", async () => {
    const c = await createClient(e0, { name: "Acme", defaultMode: "proofing" });
    await addGallery("g1", "boda");
    // Delete the client right after the select that reads it.
    let fired = false;
    const db = new Proxy(env.DB, {
      get(t, p) {
        if (p !== "prepare")
          return Reflect.get(t, p).bind?.(t) ?? Reflect.get(t, p);
        return (sql: string) => {
          const st = t.prepare(sql);
          if (!fired && /^select/i.test(sql) && /from "clients"/i.test(sql)) {
            return new Proxy(st, {
              get(s, k) {
                const v = Reflect.get(s, k);
                if (k === "bind")
                  return (...a: unknown[]) => {
                    const b = s.bind(...a);
                    return new Proxy(b, {
                      get(bb, kk) {
                        const f = Reflect.get(bb, kk);
                        if (kk === "all" || kk === "raw" || kk === "first")
                          return async (...x: unknown[]) => {
                            const r = await (
                              f as (...a: unknown[]) => Promise<unknown>
                            ).apply(bb, x);
                            fired = true;
                            await t
                              .prepare("DELETE FROM clients WHERE id = ?1")
                              .bind(c.id)
                              .run();
                            return r;
                          };
                        return typeof f === "function" ? f.bind(bb) : f;
                      },
                    });
                  };
                return typeof v === "function" ? v.bind(s) : v;
              },
            });
          }
          return st;
        };
      },
    });
    const e = { ...e0, DB: db } as Env;
    const r = await galleryAction(
      new Request("http://localhost/admin/g/g1", {
        method: "POST",
        body: new URLSearchParams({
          intent: "details",
          title: "T",
          slug: "boda",
          eventDate: "",
          expiresDate: "",
          expiresTime: "",
          clientId: c.id,
        }),
      }),
      e,
      "g1",
    );
    expect(fired).toBe(true);
    const row = await env.DB.prepare(
      "SELECT client_id, mode FROM galleries WHERE id='g1'",
    ).first<{ client_id: string | null; mode: string }>();
    expect(row!.client_id).toBeNull();
    // copied from a client that no longer exists: album must stay as it was
    expect(row!.mode).toBe("delivery");
    expect(r.message ?? "").not.toMatch(/asignad|assigned/i);
  });

  it("more than 100 clients: an album's list filter on client #101 still offers that client (not a raw id label)", async () => {
    for (let i = 0; i < 100; i++)
      await createClient(e0, { name: `A${String(i).padStart(3, "0")}` });
    const z = await createClient(e0, { name: "Zeta last" });
    await addGallery("g1", "boda");
    await env.DB.prepare("UPDATE galleries SET client_id=?1").bind(z.id).run();
    const d = await adminIndexData(
      new Request(`http://localhost/admin?cliente=${z.id}`),
      e0,
    );
    expect(d.clients.some((c) => c.id === z.id)).toBe(true);
  });

  it("more than 100 clients: client #101 can still be chosen for an album", async () => {
    for (let i = 0; i < 100; i++)
      await createClient(e0, { name: `A${String(i).padStart(3, "0")}` });
    const z = await createClient(e0, { name: "Zeta last" });
    await addGallery("g1", "boda");
    const d = await loadGalleryEdit(e0, "g1");
    expect(d!.clients.some((c) => c.id === z.id)).toBe(true);
  });
});
