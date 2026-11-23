import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateDb, resetTables } from "../support/d1";
import { clientAction } from "../../app/lib/server/admin-clients";
import { createClient, getClient } from "../../app/lib/server/clients";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
beforeAll(migrateDb);
beforeEach(() => resetTables("photos", "galleries", "clients"));
const post = (id: string, f: Record<string, string>, h: HeadersInit = {}) =>
  new Request(`http://localhost/admin/clients/${id}`, {
    method: "POST",
    headers: h,
    body: new URLSearchParams(f),
  });

describe("T6.40b delete", () => {
  it("cross-site delete is refused and the client survives", async () => {
    const c = await createClient(e, { name: "Acme", slug: "acme" });
    await clientAction(
      post(c.id, { intent: "delete", slug: "acme" }, { "sec-fetch-site": "cross-site", origin: "https://evil.example" }),
      e,
      c.id,
    ).catch(() => {});
    expect(await getClient(e, c.id)).not.toBeNull();
  });

  it("deleting a client with 250 albums unassigns all, keeps them, touches nobody else", async () => {
    const c = await createClient(e, { name: "Acme", slug: "acme" });
    const o = await createClient(e, { name: "Other", slug: "other" });
    for (let i = 0; i < 250; i++)
      await env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title, client_id) VALUES (?1,?2,?3,'T',?4)",
      ).bind(`g${i}`, `f${i}`, `s${i}`, i === 0 ? o.id : c.id).run();
    await clientAction(post(c.id, { intent: "delete", slug: " ACME " }), e, c.id).catch(() => {});
    const r = await env.DB.prepare(
      "SELECT COUNT(*) AS n, SUM(client_id IS NULL) AS u, SUM(client_id = ?1) AS o FROM galleries",
    ).bind(o.id).first<{ n: number; u: number; o: number }>();
    expect(r).toEqual({ n: 250, u: 249, o: 1 });
  });
});
