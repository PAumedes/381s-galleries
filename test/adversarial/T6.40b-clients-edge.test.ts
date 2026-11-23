import { env } from "cloudflare:workers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { migrateDb, resetTables } from "../support/d1";
import {
  clientAction,
  createClientAction,
} from "../../app/lib/server/admin-clients";
import { createClient } from "../../app/lib/server/clients";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
beforeAll(migrateDb);
beforeEach(() => resetTables("photos", "galleries", "clients"));
afterEach(() => vi.useRealTimers());

const post = (path: string, fields: Record<string, string>) =>
  new Request("http://localhost" + path, {
    method: "POST",
    body: new URLSearchParams(fields),
  });

describe("T6.40b edge cases", () => {
  it("applyDefaults: expiry stored without millis ('...:00Z') that is already past within the same second must not keep show_on_home", async () => {
    const c = await createClient(e, { name: "Acme", defaultShowOnHome: true });
    await env.DB.prepare(
      "INSERT INTO galleries (id, drive_folder_id, slug, title, client_id, status, expires_at) VALUES ('g1','f1','uno','T',?1,'published','2026-06-01T10:00:00Z')",
    )
      .bind(c.id)
      .run();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T10:00:00.250Z"));
    await clientAction(
      post(`/admin/clients/${c.id}`, { intent: "applyDefaults", confirm: "1" }),
      e,
      c.id,
    );
    const r = await env.DB.prepare(
      "SELECT show_on_home AS s FROM galleries WHERE id='g1'",
    ).first<{ s: number }>();
    expect(r!.s).toBe(0);
  });

  it("create: a name made only of zero-width/invisible characters is rejected", async () => {
    let status: unknown;
    try {
      const r = await createClientAction(
        post("/admin/clients", { name: "​‎⠀", slug: "invis" }),
        e,
      );
      status = r;
    } catch (x) {
      status = (x as Response).status;
    }
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM clients").first<{
      n: number;
    }>();
    expect(n!.n).toBe(0);
    void status;
  });
});

describe("T6.40b cleanName visibility", () => {
  const ok = [
    "José Núñez",
    "😀 Fiesta",
    "👨‍👩‍👧 Family",
    "محمد علي",
    "דוד כהן",
    "می‌خواهم",
    "Ana​ Ruiz",
    "2024",
  ];
  const bad = ["​", "‎", "⠀", "​‍‌", "ㅤ", "⁠﻿", "‏"];
  it.each(ok)("accepts %s", async (name) => {
    const c = await createClient(e, {
      name,
      slug: "n" + Math.random().toString(36).slice(2, 8),
    });
    expect(c.name.length).toBeGreaterThan(0);
  });
  it("strips plain invisible chars inside a name", async () => {
    const c = await createClient(e, { name: "Ana​ Ruiz", slug: "ana-r" });
    expect(c.name).toBe("Ana Ruiz");
  });
  it.each(bad)("rejects invisible-only %#", async (name) => {
    await expect(
      createClient(e, {
        name,
        slug: "x" + Math.random().toString(36).slice(2, 8),
      }),
    ).rejects.toMatchObject({ code: "invalidName" });
  });
  it("rename rejects invisible-only", async () => {
    const c = await createClient(e, { name: "Real", slug: "real" });
    const { updateClient } = await import("../../app/lib/server/clients");
    await expect(updateClient(e, c.id, { name: "​⠀" })).rejects.toMatchObject({
      code: "invalidName",
    });
  });
});

describe("T6.40b applyDefaults sub-second expiry", () => {
  it("expires in the future within the same second stays on; past stays off", async () => {
    const c = await createClient(e, { name: "Sub", defaultShowOnHome: true });
    for (const [id, exp] of [
      ["a", "2026-06-01T10:00:00.500Z"],
      ["b", "garbage"],
      ["c", "2026-06-01T10:00:01Z"],
    ])
      await env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title, client_id, status, expires_at) VALUES (?1,?1,?1,'T',?2,'published',?3)",
      )
        .bind(id, c.id, exp)
        .run();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T10:00:00.250Z"));
    await clientAction(
      post(`/admin/clients/${c.id}`, { intent: "applyDefaults", confirm: "1" }),
      e,
      c.id,
    );
    const r = await env.DB.prepare(
      "SELECT id, show_on_home AS s FROM galleries ORDER BY id",
    ).all<{ id: string; s: number }>();
    expect(r.results.map((x) => x.s)).toEqual([1, 0, 1]);
  });
});
