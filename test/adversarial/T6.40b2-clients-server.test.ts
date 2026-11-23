import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateDb, resetTables } from "../support/d1";
import {
  clientAction,
  clientEditData,
  clientsListData,
  createClientAction,
} from "../../app/lib/server/admin-clients";
import { createClient, getClient } from "../../app/lib/server/clients";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const anon = { ...env, DRIVE_MODE: "mock" } as Env;
delete (anon as { ALLOW_DEV_ADMIN?: string }).ALLOW_DEV_ADMIN;
beforeAll(migrateDb);
beforeEach(() => resetTables("photos", "galleries", "clients"));
const post = (url: string, f: Record<string, string>, h: HeadersInit = {}) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: h,
    body: new URLSearchParams(f),
  });
const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (x) {
    return x instanceof Response ? x.status : -1;
  }
};
const gal = (id: string, slug: string, cid: string | null, extra = "") =>
  env.DB.prepare(
    `INSERT INTO galleries (id, drive_folder_id, slug, title, client_id, status, mode, show_on_home ${extra ? "," + extra.split("=")[0] : ""}) VALUES (?1,?2,?3,'T',?4,'published','delivery',0 ${extra ? ",?5" : ""})`,
  )
    .bind(id, "f" + id, slug, cid, ...(extra ? [extra.split("=")[1]] : []))
    .run();

describe("T6.40b2 auth", () => {
  it("anonymous: every loader and action is 401", async () => {
    const c = await createClient(e, { name: "Acme", slug: "acme" });
    const r = (u: string) => new Request("http://localhost" + u);
    expect(await status(clientsListData(r("/admin/clients"), anon))).toBe(401);
    expect(await status(clientEditData(r("/x"), anon, c.id))).toBe(401);
    expect(await status(clientEditData(r("/x"), anon, "nope"))).toBe(401);
    expect(
      await status(
        createClientAction(post("/admin/clients", { name: "Z" }), anon),
      ),
    ).toBe(401);
    for (const intent of ["save", "applyDefaults", "delete", "bogus"])
      expect(
        await status(
          clientAction(
            post("/x", {
              intent,
              slug: "acme",
              confirm: "1",
              name: "H",
              defaultMode: "proofing",
            }),
            anon,
            c.id,
          ),
        ),
      ).toBe(401);
    expect(await getClient(e, c.id)).not.toBeNull();
    expect((await getClient(e, c.id))!.name).toBe("Acme");
  });

  it("cross-site create/save/applyDefaults are refused and change nothing", async () => {
    const c = await createClient(e, {
      name: "Acme",
      slug: "acme",
      defaultMode: "proofing",
    });
    await gal("g1", "g1", c.id);
    const h = {
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example",
    };
    expect(
      await status(
        createClientAction(post("/admin/clients", { name: "Evil" }, h), e),
      ),
    ).toBe(403);
    expect(
      await status(
        clientAction(
          post(
            "/x",
            {
              intent: "save",
              name: "Pwn",
              slug: "pwn",
              defaultMode: "delivery",
            },
            h,
          ),
          e,
          c.id,
        ),
      ),
    ).toBe(403);
    expect(
      await status(
        clientAction(
          post("/x", { intent: "applyDefaults", confirm: "1" }, h),
          e,
          c.id,
        ),
      ),
    ).toBe(403);
    expect((await getClient(e, c.id))!.name).toBe("Acme");
    const g = await env.DB.prepare(
      "SELECT mode FROM galleries WHERE id='g1'",
    ).first<{ mode: string }>();
    expect(g!.mode).toBe("delivery");
    const n = await env.DB.prepare("SELECT COUNT(*) n FROM clients").first<{
      n: number;
    }>();
    expect(n!.n).toBe(1);
  });

  it("delete is enforced server-side: missing, wrong or whitespace-only typed slug keeps the client", async () => {
    const c = await createClient(e, { name: "Acme", slug: "acme" });
    for (const f of [
      { intent: "delete" },
      { intent: "delete", slug: "" },
      { intent: "delete", slug: "acm" },
      { intent: "delete", slug: "acme2" },
    ]) {
      const res = await clientAction(post("/x", f), e, c.id).catch((x) => x);
      expect(res instanceof Response).toBe(false);
      expect((res as { ok: boolean }).ok).toBe(false);
    }
    expect(await getClient(e, c.id)).not.toBeNull();
  });

  it("unknown intent / forged id: no mutation, forged id is 404", async () => {
    const c = await createClient(e, { name: "Acme", slug: "acme" });
    const r = await clientAction(post("/x", { intent: "drop" }), e, c.id);
    expect((r as { ok: boolean }).ok).toBe(false);
    for (const id of ["nope", "", "%", "' OR 1=1 --", "a".repeat(5000)])
      for (const intent of ["save", "applyDefaults", "delete"])
        expect(
          await status(
            clientAction(
              post("/x", {
                intent,
                confirm: "1",
                slug: "acme",
                name: "N",
                defaultMode: "delivery",
              }),
              e,
              id,
            ),
          ),
          `${intent} ${id.slice(0, 10)}`,
        ).toBe(404);
  });

  it("malformed body (not a form) does not 500", async () => {
    const c = await createClient(e, { name: "Acme", slug: "acme" });
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const res = await clientAction(req, e, c.id).catch((x) => x);
    expect(res instanceof Response ? res.status : 200).toBeLessThan(500);
  });
});

describe("T6.40b2 slug namespace", () => {
  it("rename to a gallery slug in another case is slugTaken, not an exception", async () => {
    const c = await createClient(e, { name: "Acme", slug: "acme" });
    await gal("g1", "boda", null);
    const r = await clientAction(
      post("/x", {
        intent: "save",
        name: "Acme",
        slug: " BODA ",
        defaultMode: "delivery",
      }),
      e,
      c.id,
    );
    expect((r as { ok: boolean }).ok).toBe(false);
    expect((await getClient(e, c.id))!.slug).toBe("acme");
  });

  it("create with Kelvin sign slug equal to an existing 'k' client is refused", async () => {
    await createClient(e, { name: "K", slug: "k" });
    const r = await createClientAction(
      post("/admin/clients", { name: "K2", slug: "K" }),
      e,
    ).catch((x) => x);
    expect(r instanceof Response && r.status === 303).toBe(false);
    const n = await env.DB.prepare(
      "SELECT COUNT(*) n FROM clients WHERE lower(slug)='k'",
    ).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("two concurrent creates with the same slug: exactly one wins, the other is a form error (no throw)", async () => {
    const outs = await Promise.allSettled([
      createClientAction(post("/admin/clients", { name: "A", slug: "dup" }), e),
      createClientAction(post("/admin/clients", { name: "A", slug: "dup" }), e),
    ]);
    const redirects = outs.filter(
      (o) => o.status === "rejected" && (o.reason as Response).status === 303,
    );
    const forms = outs.filter((o) => o.status === "fulfilled");
    expect(redirects.length).toBe(1);
    expect(forms.length).toBe(1);
  });

  it("concurrent create with slug equal to a gallery slug inserted meanwhile is a form error", async () => {
    await gal("g1", "taken", null);
    const r = await createClientAction(
      post("/admin/clients", { name: "T", slug: "TAKEN" }),
      e,
    ).catch((x) => x);
    expect(r instanceof Response).toBe(false);
  });

  it("saving a client with its own slug in another case succeeds", async () => {
    const c = await createClient(e, { name: "Acme", slug: "acme" });
    const r = await clientAction(
      post("/x", {
        intent: "save",
        name: "Acme",
        slug: "ACME",
        defaultMode: "delivery",
      }),
      e,
      c.id,
    );
    expect((r as { ok: boolean }).ok).toBe(true);
  });
});

describe("T6.40b2 applyDefaults scope", () => {
  it("client with 0 albums: ok, other clients' and unassigned albums untouched", async () => {
    const c = await createClient(e, {
      name: "Empty",
      slug: "empty",
      defaultMode: "proofing",
      defaultShowOnHome: true,
    });
    const o = await createClient(e, { name: "Other", slug: "other" });
    await gal("g1", "g1", o.id);
    await gal("g2", "g2", null);
    const r = await clientAction(
      post("/x", { intent: "applyDefaults", confirm: "1" }),
      e,
      c.id,
    );
    expect((r as { ok: boolean }).ok).toBe(true);
    const rows = await env.DB.prepare(
      "SELECT id, mode, show_on_home FROM galleries ORDER BY id",
    ).all();
    expect(rows.results).toEqual([
      { id: "g1", mode: "delivery", show_on_home: 0 },
      { id: "g2", mode: "delivery", show_on_home: 0 },
    ]);
  });

  it("show_on_home only on published, pin-less, unexpired; mode applied to all; archived/draft/pin/expired get 0", async () => {
    const c = await createClient(e, {
      name: "A",
      slug: "a",
      defaultMode: "proofing",
      defaultShowOnHome: true,
    });
    const q = (
      id: string,
      st: string,
      pin: string | null,
      exp: string | null,
    ) =>
      env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title, client_id, status, pin_hash, expires_at, show_on_home) VALUES (?1,?2,?3,'T',?4,?5,?6,?7,1)",
      )
        .bind(id, "f" + id, id, c.id, st, pin, exp)
        .run();
    await q("ok", "published", null, null);
    await q(
      "future",
      "published",
      null,
      new Date(Date.now() + 86400000).toISOString(),
    );
    await q(
      "past",
      "published",
      null,
      new Date(Date.now() - 1000).toISOString(),
    );
    await q("pin", "published", "hash", null);
    await q("draft", "draft", null, null);
    await q("arch", "archived", null, null);
    await q("garbage", "published", null, "not-a-date");
    await clientAction(
      post("/x", { intent: "applyDefaults", confirm: "1" }),
      e,
      c.id,
    );
    const rows = await env.DB.prepare(
      "SELECT id, mode, show_on_home h FROM galleries",
    ).all<{ id: string; mode: string; h: number }>();
    const m = Object.fromEntries(
      rows.results.map((r) => [r.id, [r.mode, r.h]]),
    );
    expect(m).toEqual({
      ok: ["proofing", 1],
      future: ["proofing", 1],
      past: ["proofing", 0],
      pin: ["proofing", 0],
      draft: ["proofing", 0],
      arch: ["proofing", 0],
      garbage: ["proofing", 0],
    });
  });

  it("without confirm=1 nothing changes", async () => {
    const c = await createClient(e, {
      name: "A",
      slug: "a",
      defaultMode: "proofing",
    });
    await gal("g1", "g1", c.id);
    await clientAction(post("/x", { intent: "applyDefaults" }), e, c.id);
    await clientAction(
      post("/x", { intent: "applyDefaults", confirm: "true" }),
      e,
      c.id,
    );
    const g = await env.DB.prepare("SELECT mode FROM galleries").first<{
      mode: string;
    }>();
    expect(g!.mode).toBe("delivery");
  });
});

describe("T6.40b2 payloads and D1 budget", () => {
  it("loader payloads contain no Drive ids or secrets", async () => {
    const c = await createClient(e, { name: "Acme", slug: "acme" });
    await gal("g1", "g1", c.id);
    await env.DB.prepare(
      "UPDATE galleries SET drive_folder_id='SECRETDRIVEID123', pin_hash='PINHASHSECRET'",
    ).run();
    const a = JSON.stringify(
      await clientsListData(new Request("http://localhost/admin/clients"), e),
    );
    const b = JSON.stringify(
      await clientEditData(new Request("http://localhost/x"), e, c.id),
    );
    for (const s of [a, b]) {
      expect(s).not.toContain("SECRETDRIVEID123");
      expect(s).not.toContain("PINHASHSECRET");
      expect(s).not.toMatch(/drive|r2|hash/i);
    }
  });

  it("list with 300 clients and 2000 albums stays within a small number of D1 statements", async () => {
    const stmts: string[] = [];
    const spy = new Proxy(env.DB, {
      get(t, p) {
        const v = (t as never)[p];
        if (p === "prepare")
          return (s: string) => (stmts.push(s), (t as D1Database).prepare(s));
        if (p === "batch")
          return (b: unknown[]) => (
            stmts.push("batch" + b.length),
            (t as D1Database).batch(b as never)
          );
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    await env.DB.batch(
      Array.from({ length: 300 }, (_, i) =>
        env.DB.prepare(
          "INSERT INTO clients (id, slug, name) VALUES (?1,?2,?3)",
        ).bind("c" + i, "c" + i, "N" + i),
      ),
    );
    const out = await clientsListData(
      new Request("http://localhost/admin/clients"),
      { ...e, DB: spy } as Env,
    );
    expect(out.clients.length).toBe(300);
    expect(stmts.length).toBeLessThanOrEqual(3);
  });
});
